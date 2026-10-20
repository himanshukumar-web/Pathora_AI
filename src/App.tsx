import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Language, DetectedItem, AssistanceStatus } from './types';
import { detectorService } from './services/detector';
import { speechService } from './services/speech';
import { buildAlertPhrase, alertRulesSelfCheck } from './services/alertRules';
import './style.css';

export const App: React.FC = () => {
  const [status, setStatus] = useState<AssistanceStatus>('idle');
  const [language, setLanguage] = useState<Language>('en');
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeAlert, setActiveAlert] = useState<string>('System ready. Press Start Assistance to begin.');
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([]);
  const [fps, setFps] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimeRef = useRef<number>(performance.now());

  // Run Ponytail verification self-check on mount
  useEffect(() => {
    const passed = alertRulesSelfCheck();
    if (!passed) {
      console.warn('Alert rules self-check did not pass default assertions.');
    }
  }, []);

  // Sync speech settings
  useEffect(() => {
    speechService.setEnabled(speechEnabled);
  }, [speechEnabled]);

  useEffect(() => {
    speechService.setLanguage(language);
  }, [language]);

  // Clean stop all camera tracks and animation loops
  const stopAssistance = useCallback(() => {
    if (animationFrameIdRef.current) {
      cancelAnimationFrame(animationFrameIdRef.current);
      animationFrameIdRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    speechService.stop();
    setStatus('idle');
    setDetectedItems([]);
    setFps(0);

    const stoppedMsg = language === 'hi' ? 'सहायता रोक दी गई है।' : 'Assistance stopped.';
    setActiveAlert(stoppedMsg);
    speechService.speak(stoppedMsg, 'system-stop', true);
  }, [language]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAssistance();
      detectorService.dispose();
    };
  }, [stopAssistance]);

  // Draw bounding boxes on canvas
  const drawDetections = (items: DetectedItem[], videoWidth: number, videoHeight: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const item of items) {
      const { originX, originY, width, height } = item.box;
      const isHighPriority = item.priority === 'high';

      // Box styling
      ctx.strokeStyle = isHighPriority ? '#f43f5e' : '#38bdf8';
      ctx.lineWidth = 3;
      ctx.strokeRect(originX, originY, width, height);

      // Label background
      const labelText = `${language === 'hi' ? item.labelHi : item.labelEn} ${Math.round(item.score * 100)}%`;
      ctx.font = 'bold 15px Inter, sans-serif';
      const textMetrics = ctx.measureText(labelText);
      const bgHeight = 22;
      const bgWidth = textMetrics.width + 12;

      ctx.fillStyle = isHighPriority ? '#f43f5e' : '#0284c7';
      ctx.fillRect(originX, Math.max(0, originY - bgHeight), bgWidth, bgHeight);

      // Text label
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, originX + 6, Math.max(16, originY - 6));
    }
  };

  // Inference animation loop
  const runDetectionLoop = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      animationFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
      return;
    }

    const now = performance.now();
    frameCountRef.current += 1;
    if (now - lastFpsTimeRef.current >= 1000) {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
      lastFpsTimeRef.current = now;
    }

    const items = detectorService.detect(video, now);
    if (items.length > 0) {
      setDetectedItems(items);
      drawDetections(items, video.videoWidth, video.videoHeight);

      // Generate voice alert for the highest priority item
      const topItem = items[0];
      const alert = buildAlertPhrase(topItem, language);
      setActiveAlert(alert.displayText);
      speechService.speak(alert.speechText, topItem.category);
    } else {
      // Clear bounding boxes if no objects
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }

    animationFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
  }, [language]);

  // Start assistance workflow
  const startAssistance = async () => {
    setErrorMessage(null);
    setStatus('loading-model');

    const initMsg = language === 'hi' ? 'मॉडल लोड हो रहा है, कृपया प्रतीक्षा करें।' : 'Loading vision model, please wait.';
    setActiveAlert(initMsg);

    try {
      // Step 1: Initialize MediaPipe Object Detector
      await detectorService.initialize();

      // Step 2: Request Camera Access (prefer back camera on mobile)
      setStatus('requesting-camera');
      const camMsg = language === 'hi' ? 'कैमरा शुरू हो रहा है।' : 'Requesting camera access.';
      setActiveAlert(camMsg);

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API is not supported on this browser or connection is not secure (HTTPS required).');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          setStatus('active');
          const readyMsg = language === 'hi' ? 'सहायता सक्रिय है।' : 'Assistance is active.';
          setActiveAlert(readyMsg);
          speechService.speak(readyMsg, 'system-start', true);
          // Launch detection loop
          animationFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
        };
      }
    } catch (err: unknown) {
      console.error('Error starting assistance:', err);
      setStatus('error');
      const msg = err instanceof Error ? err.message : 'Failed to access camera or load model.';
      setErrorMessage(msg);
      const voiceErr = language === 'hi' ? 'कैमरा या मॉडल लोड करने में त्रुटि।' : 'Error starting camera or loading AI model.';
      setActiveAlert(voiceErr);
      speechService.speak(voiceErr, 'system-error', true);
    }
  };

  const handleLanguageToggle = (newLang: Language) => {
    setLanguage(newLang);
    const switchMsg = newLang === 'hi' ? 'हिंदी भाषा चुनी गई।' : 'English language selected.';
    speechService.speak(switchMsg, 'lang-change', true);
  };

  const handleSpeechToggle = () => {
    const nextState = !speechEnabled;
    setSpeechEnabled(nextState);
    if (nextState) {
      const msg = language === 'hi' ? 'आवाज़ चालू है।' : 'Voice alerts enabled.';
      speechService.speak(msg, 'sound-toggle', true);
    }
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header" role="banner">
        <div className="brand-wrapper">
          <div className="brand-logo-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div>
            <h1 className="app-title">Pathora AI</h1>
            <p className="app-tagline">
              {language === 'hi' ? 'दृष्टि और बाधा जागरूकता सहायता' : 'Assistive Vision & Obstacle Awareness'}
            </p>
          </div>
        </div>

        <div className="header-actions">
          {/* Language Selector */}
          <div className="lang-selector-group" role="group" aria-label="Select Language">
            <button
              type="button"
              className={`lang-btn ${language === 'en' ? 'active' : ''}`}
              onClick={() => handleLanguageToggle('en')}
              aria-pressed={language === 'en'}
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${language === 'hi' ? 'active' : ''}`}
              onClick={() => handleLanguageToggle('hi')}
              aria-pressed={language === 'hi'}
            >
              हिन्दी
            </button>
          </div>

          {/* Voice Toggle */}
          <button
            type="button"
            className={`icon-toggle-btn ${!speechEnabled ? 'muted' : ''}`}
            onClick={handleSpeechToggle}
            aria-label={speechEnabled ? 'Mute voice alerts' : 'Unmute voice alerts'}
          >
            {speechEnabled ? (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
                <span>Voice On</span>
              </>
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <line x1="22" y1="9" x2="16" y2="15" />
                  <line x1="16" y1="9" x2="22" y2="15" />
                </svg>
                <span>Muted</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Safety Advisory Banner */}
      <aside className="safety-banner" role="complementary" aria-label="Safety notice">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <p>
          <strong>{language === 'hi' ? 'सुरक्षा सूचना:' : 'Safety Advisory:'}</strong>{' '}
          {language === 'hi'
            ? 'पैथोरा एआई एक प्रायोगिक सहायता साधन है। यह सफ़ेद छड़ी (white cane) या गाइड डॉग का विकल्प नहीं है। सड़क पार करने या पूर्ण सुरक्षा के लिए केवल कैमरा अनुमान पर निर्भर न रहें।'
            : 'Pathora AI is an experimental supplement and NOT a replacement for a white cane or certified mobility aid. Never rely solely on camera predictions for street crossing or hazard navigation.'}
        </p>
      </aside>

      {/* Primary Action Button */}
      <nav className="controls-bar" aria-label="Main Controls">
        {status === 'active' ? (
          <button
            type="button"
            className="btn-primary-action btn-stop"
            onClick={stopAssistance}
            aria-label="Stop vision assistance"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            <span>{language === 'hi' ? 'सहायता बंद करें' : 'Stop Assistance'}</span>
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary-action btn-start"
            onClick={startAssistance}
            disabled={status === 'loading-model' || status === 'requesting-camera'}
            aria-label="Start vision assistance"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>
              {status === 'loading-model'
                ? language === 'hi' ? 'मॉडल लोड हो रहा है...' : 'Loading Model...'
                : status === 'requesting-camera'
                ? language === 'hi' ? 'कैमरा जुड़ रहा है...' : 'Opening Camera...'
                : language === 'hi' ? 'सहायता शुरू करें' : 'Start Assistance'}
            </span>
          </button>
        )}
      </nav>

      {/* Error message banner */}
      {errorMessage && (
        <div className="error-banner" role="alert">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div>
            <strong>{language === 'hi' ? 'त्रुटि:' : 'Error:'}</strong> {errorMessage}
          </div>
        </div>
      )}

      {/* Video Viewport Stage */}
      <section className="vision-stage" aria-label="Camera preview stage">
        <video
          ref={videoRef}
          className="camera-feed"
          playsInline
          muted
          autoPlay
          aria-hidden="true"
          style={{ display: status === 'active' ? 'block' : 'none' }}
        />
        <canvas
          ref={canvasRef}
          className="detection-canvas"
          aria-hidden="true"
          style={{ display: status === 'active' ? 'block' : 'none' }}
        />

        {status !== 'active' && (
          <div className="stage-placeholder" aria-hidden="true">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            <p>
              {status === 'loading-model' || status === 'requesting-camera'
                ? (language === 'hi' ? 'आरंभ किया जा रहा है...' : 'Initializing camera and AI engine...')
                : (language === 'hi' ? 'कैमरा फ़ीड देखने के लिए सहायता शुरू करें दबाएं' : 'Press "Start Assistance" to activate live camera feed')}
            </p>
          </div>
        )}

        {status === 'active' && (
          <div className="stage-badges" aria-hidden="true">
            <span className="badge active">
              <span className="badge-dot" /> Live
            </span>
            <span className="badge">
              {fps} FPS
            </span>
          </div>
        )}
      </section>

      {/* Dashboard: Live Status & Detections */}
      <main className="dashboard-grid">
        {/* Real-time Alert & Live Status */}
        <section className="card" aria-labelledby="live-status-heading">
          <div className="card-header">
            <h2 id="live-status-heading" className="card-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {language === 'hi' ? 'वर्तमान स्थिति' : 'Live Awareness'}
            </h2>
          </div>

          {/* ARIA Live Region for Screen Readers */}
          <div
            className={`active-alert-box ${detectedItems.some(i => i.priority === 'high') ? 'priority-high' : ''}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="alert-label">
              {language === 'hi' ? 'वर्तमान उद्घोषणा' : 'Current Announcement'}
            </span>
            <p className="alert-text">{activeAlert}</p>
          </div>

          {/* Detected Objects List */}
          <div>
            <h3 className="card-title" style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              {language === 'hi' ? 'पहचाने गए तत्व' : 'Detected Elements'} ({detectedItems.length})
            </h3>
            <div className="detected-list" aria-label="Detected objects list">
              {detectedItems.length === 0 ? (
                <div className="empty-chip-state">
                  {status === 'active'
                    ? (language === 'hi' ? 'दृश्य में कोई प्रमुख वस्तु नहीं मिली' : 'No prominent objects detected in frame')
                    : (language === 'hi' ? 'सहायता प्रारंभ होने की प्रतीक्षा है' : 'Waiting for assistance to start')}
                </div>
              ) : (
                detectedItems.map((item) => (
                  <div
                    key={item.id}
                    className={`detected-chip ${item.priority === 'high' ? 'priority-high' : ''}`}
                  >
                    <span>{language === 'hi' ? item.labelHi : item.labelEn}</span>
                    <span className="chip-confidence">{Math.round(item.score * 100)}%</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Detailed Scene Assistance Placeholder */}
        <section className="card future-card" aria-labelledby="scene-assistant-heading">
          <div className="card-header">
            <h2 id="scene-assistant-heading" className="card-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <path d="m4.93 4.93 4.24 4.24" />
                <path d="m14.83 9.17 4.24-4.24" />
                <path d="m14.83 14.83 4.24 4.24" />
                <path d="m9.17 14.83-4.24 4.24" />
              </svg>
              {language === 'hi' ? 'विस्तृत दृश्य विवरण' : 'Detailed Scene Assistance'}
            </h2>
            <span className="tag-unavailable">{language === 'hi' ? 'अनागत' : 'Upcoming'}</span>
          </div>
          <p className="future-desc">
            {language === 'hi'
              ? 'गहराई अनुमान (Depth estimation), चलने योग्य क्षेत्र विभाजन (Walkable area segmentation) और विस्तृत परिदृश्य विवरण भविष्य के अपडेट में उपलब्ध होंगे।'
              : 'Depth estimation, walkable ground segmentation, and narrative scene narration will be integrated in future phases.'}
          </p>
          <button
            type="button"
            className="icon-toggle-btn"
            style={{ width: '100%', justifyContent: 'center', opacity: 0.6, cursor: 'not-allowed' }}
            disabled
            aria-disabled="true"
          >
            {language === 'hi' ? 'वर्तमान में अनुपलब्ध' : 'Currently Unavailable'}
          </button>
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer" role="contentinfo">
        <p>
          Pathora AI (Prototype) &bull; Built with MediaPipe Tasks Vision (Apache-2.0) &bull; Runs 100% locally in browser
        </p>
      </footer>
    </div>
  );
};
export default App;
