import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Language, DetectedItem, AssistanceStatus, SpeechRate, VoiceOption } from './types';
import { detectorService } from './services/detector';
import { speechService } from './services/speech';
import { buildAlertPhrase, alertRulesSelfCheck, estimateProximity, getFramePosition, getSystemMessage } from './services/alertRules';
import './style.css';

export const App: React.FC = () => {
  const [status, setStatus] = useState<AssistanceStatus>('idle');
  const [language, setLanguage] = useState<Language>(() => speechService.getLanguage());
  const [speechEnabled, setSpeechEnabled] = useState<boolean>(() => speechService.isEnabled());
  const [speechRate, setSpeechRate] = useState<SpeechRate>(() => speechService.getRate());
  const [speechVolume, setSpeechVolume] = useState<number>(() => speechService.getVolume());
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>(() => speechService.getSelectedVoiceURI() || '');
  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>(() => speechService.getAvailableVoices());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(true);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeAlert, setActiveAlert] = useState<string>(() => {
    const l = speechService.getLanguage();
    if (l === 'hi') return 'सिस्टम तैयार है। सहायता शुरू करने के लिए "सहायता शुरू करें" दबाएं।';
    if (l === 'hinglish') return 'System ready hai. Assistance shuru karne ke liye "Start Assistance" dabayein.';
    return 'System ready. Press Start Assistance to begin.';
  });
  const [detectedItems, setDetectedItems] = useState<DetectedItem[]>([]);
  const [fps, setFps] = useState<number>(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameIdRef = useRef<number | null>(null);
  const frameCountRef = useRef<number>(0);
  const lastFpsTimeRef = useRef<number>(performance.now());

  // Refs to avoid stale closures in the rAF loop
  const languageRef = useRef<Language>(language);
  const runningRef = useRef<boolean>(false);
  const noDetectionCountRef = useRef<number>(0);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Run self-check once on mount
  useEffect(() => {
    const passed = alertRulesSelfCheck();
    if (!passed) console.warn('Alert rules self-check failed.');
  }, []);

  // Listen for available system voices
  useEffect(() => {
    const unsubscribe = speechService.onVoicesChanged((voices) => {
      setAvailableVoices(voices);
    });
    return unsubscribe;
  }, []);

  // Sync state changes with speechService
  useEffect(() => {
    speechService.setEnabled(speechEnabled);
  }, [speechEnabled]);

  useEffect(() => {
    speechService.setLanguage(language);
  }, [language]);

  useEffect(() => {
    speechService.setRate(speechRate);
  }, [speechRate]);

  useEffect(() => {
    speechService.setVolume(speechVolume);
  }, [speechVolume]);

  useEffect(() => {
    speechService.setVoice(selectedVoiceURI || null);
  }, [selectedVoiceURI]);

  // Stop assistance and release camera
  const stopAssistance = useCallback(() => {
    runningRef.current = false;

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

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }

    speechService.stop();
    setStatus('idle');
    setDetectedItems([]);
    setFps(0);

    const lang = languageRef.current;
    const stoppedMsg = getSystemMessage('stopAssistance', lang);
    setActiveAlert(stoppedMsg);
    speechService.speak(stoppedMsg, 'system-stop', true, 'high');
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAssistance();
      detectorService.dispose();
    };
  }, [stopAssistance]);

  // Handle Repeat Last Alert
  const handleRepeatAlert = useCallback(() => {
    const repeated = speechService.repeatLastAlert();
    if (!repeated) {
      const msg = getSystemMessage('noPreviousAlert', languageRef.current);
      setActiveAlert(msg);
      speechService.speak(msg, 'no-prev-alert', true, 'medium');
    }
  }, []);

  // Handle Test Voice
  const handleTestVoice = useCallback(() => {
    const testMsg = getSystemMessage('testVoiceSample', languageRef.current);
    setActiveAlert(testMsg);
    speechService.speak(testMsg, 'test-voice', true, 'high');
  }, []);

  // Handle Voice Mute Toggle
  const handleSpeechToggle = useCallback(() => {
    const nextState = !speechEnabled;
    setSpeechEnabled(nextState);
    speechService.setEnabled(nextState);
    if (nextState) {
      const msg = getSystemMessage('voiceEnabled', languageRef.current);
      speechService.speak(msg, 'sound-toggle', true, 'high');
    }
  }, [speechEnabled]);

  // Keyboard accessibility shortcuts (Alt+R, Alt+T, Alt+M, Alt+S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in a form input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.altKey && (e.key === 'r' || e.key === 'R')) {
        e.preventDefault();
        handleRepeatAlert();
      } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault();
        handleTestVoice();
      } else if (e.altKey && (e.key === 'm' || e.key === 'M')) {
        e.preventDefault();
        handleSpeechToggle();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRepeatAlert, handleTestVoice, handleSpeechToggle]);

  // Draw bounding boxes + proximity labels on canvas overlay
  const drawDetections = useCallback((items: DetectedItem[], videoWidth: number, videoHeight: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lang = languageRef.current;

    for (const item of items) {
      const { originX, originY, width, height } = item.box;
      const isHighPriority = item.priority === 'high';
      const prox = estimateProximity(height, videoHeight);
      const pos = getFramePosition(originX, width, videoWidth);

      // Box
      ctx.strokeStyle = isHighPriority ? '#f43f5e' : '#38bdf8';
      ctx.lineWidth = 3;
      ctx.strokeRect(originX, originY, width, height);

      // Label
      let posShort = 'C';
      if (lang === 'hi') {
        posShort = pos === 'left' ? 'बाएँ' : pos === 'right' ? 'दाएँ' : 'सामने';
      } else if (lang === 'hinglish') {
        posShort = pos === 'left' ? 'Left' : pos === 'right' ? 'Right' : 'Saamne';
      } else {
        posShort = pos === 'left' ? 'L' : pos === 'right' ? 'R' : 'C';
      }

      let proxShort = '?';
      if (lang === 'hi') {
        proxShort = prox === 'near' ? 'पास' : prox === 'medium' ? 'मध्यम' : prox === 'far' ? 'दूर' : '?';
      } else if (lang === 'hinglish') {
        proxShort = prox === 'near' ? 'Near' : prox === 'medium' ? 'Mid' : prox === 'far' ? 'Far' : '?';
      } else {
        proxShort = prox === 'near' ? 'Near' : prox === 'medium' ? 'Mid' : prox === 'far' ? 'Far' : '?';
      }

      let nameLabel = item.labelEn;
      if (lang === 'hi') nameLabel = item.labelHi;
      else if (lang === 'hinglish') nameLabel = item.labelHinglish || item.labelEn;

      const labelText = `${nameLabel} ${Math.round(item.score * 100)}% [${posShort} · ${proxShort}]`;

      ctx.font = 'bold 14px Inter, sans-serif';
      const textMetrics = ctx.measureText(labelText);
      const bgH = 22;
      const bgW = textMetrics.width + 12;

      ctx.fillStyle = isHighPriority ? 'rgba(244,63,94,0.88)' : 'rgba(2,132,199,0.88)';
      ctx.fillRect(originX, Math.max(0, originY - bgH), bgW, bgH);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(labelText, originX + 6, Math.max(16, originY - 6));
    }
  }, []);

  // The rAF detection loop
  const runDetectionLoop = useCallback(() => {
    if (!runningRef.current) return;

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
    const lang = languageRef.current;

    if (items.length > 0) {
      noDetectionCountRef.current = 0;
      setDetectedItems(items);
      drawDetections(items, video.videoWidth, video.videoHeight);

      // Speak highest priority detection with position and proximity
      const topItem = items[0];
      const alert = buildAlertPhrase(topItem, lang, video.videoWidth, video.videoHeight);
      setActiveAlert(alert.displayText);

      const pos = getFramePosition(topItem.box.originX, topItem.box.width, video.videoWidth);
      const dedupeKey = `${topItem.category}-${pos}`;
      speechService.speak(alert.speechText, dedupeKey, false, alert.priority);
    } else {
      noDetectionCountRef.current += 1;
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }

      // After ~3 seconds of no detections, announce once
      if (noDetectionCountRef.current === 15) {
        const noDetMsg = getSystemMessage('noDetections', lang);
        setActiveAlert(noDetMsg);
        speechService.speak(noDetMsg, 'no-detection', false, 'low');
        setDetectedItems([]);
      }
    }

    animationFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
  }, [drawDetections]);

  // Start Assistance
  const startAssistance = async () => {
    setErrorMessage(null);
    setStatus('loading-model');

    const lang = languageRef.current;
    const initMsg = getSystemMessage('loadingModel', lang);
    setActiveAlert(initMsg);
    speechService.speak(initMsg, 'system-loading', true, 'high');

    try {
      await detectorService.initialize();

      setStatus('requesting-camera');
      const camMsg = getSystemMessage('openingCamera', lang);
      setActiveAlert(camMsg);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          lang === 'hi'
            ? 'कैमरा API इस ब्राउज़र में उपलब्ध नहीं है। HTTPS कनेक्शन आवश्यक है।'
            : lang === 'hinglish'
            ? 'Camera API browser mein support nahi kar rahi. HTTPS connection zaroori ho sakta hai.'
            : 'Camera API not supported. HTTPS connection may be required.'
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play();
          runningRef.current = true;
          noDetectionCountRef.current = 0;
          setStatus('active');
          speechService.resetCooldowns();

          const readyLang = languageRef.current;
          const readyMsg = getSystemMessage('startAssistance', readyLang);
          setActiveAlert(readyMsg);
          speechService.speak(readyMsg, 'system-start', true, 'high');

          animationFrameIdRef.current = requestAnimationFrame(runDetectionLoop);
        };
      }
    } catch (err: unknown) {
      console.error('Error starting assistance:', err);
      setStatus('error');
      const lang2 = languageRef.current;
      let msg: string;
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        msg =
          lang2 === 'hi'
            ? 'कैमरा अनुमति अस्वीकार कर दी गई है। कृपया ब्राउज़र सेटिंग्स में कैमरा एक्सेस की अनुमति दें।'
            : lang2 === 'hinglish'
            ? 'Camera permission deny ho gayi hai. Please browser settings mein camera allow karein.'
            : 'Camera permission was denied. Please allow camera access in browser settings.';
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        msg =
          lang2 === 'hi'
            ? 'कोई कैमरा नहीं मिला। कृपया जाँचें कि कैमरा जुड़ा हुआ है।'
            : lang2 === 'hinglish'
            ? 'Koi camera nahi mila. Please check karein camera connected hai ya nahi.'
            : 'No camera found. Please check that a camera is connected.';
      } else {
        msg = err instanceof Error ? err.message : 'Failed to access camera or load model.';
      }
      setErrorMessage(msg);
      setActiveAlert(msg);
      speechService.speak(getSystemMessage('cameraError', lang2), 'system-error', true, 'high');
    }
  };

  // Change Language
  const handleLanguageChange = (newLang: Language) => {
    setLanguage(newLang);
    languageRef.current = newLang;
    speechService.setLanguage(newLang);

    let switchMsg = '';
    if (newLang === 'hi') switchMsg = getSystemMessage('langChangedHi', newLang);
    else if (newLang === 'hinglish') switchMsg = getSystemMessage('langChangedHinglish', newLang);
    else switchMsg = getSystemMessage('langChangedEn', newLang);

    speechService.speak(switchMsg, 'lang-change', true, 'high');
  };

  // Filter or sort voices matching current language for user convenience
  const matchedVoices = availableVoices.filter((v) => {
    const l = v.lang.toLowerCase();
    if (language === 'hi') return l.startsWith('hi') || l === 'en-in';
    if (language === 'hinglish') return l === 'en-in' || l.startsWith('hi') || l.startsWith('en');
    return l.startsWith('en');
  });

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
              {language === 'hi'
                ? 'दृष्टि और बाधा जागरूकता सहायता'
                : language === 'hinglish'
                ? 'Assistive Vision & Natural Voice Guide'
                : 'Assistive Vision & Obstacle Awareness'}
            </p>
          </div>
        </div>

        <div className="header-actions">
          {/* Top 3-Way Language Selector */}
          <div className="lang-selector-group" role="group" aria-label="Select Language">
            <button
              type="button"
              className={`lang-btn ${language === 'en' ? 'active' : ''}`}
              onClick={() => handleLanguageChange('en')}
              aria-pressed={language === 'en'}
              aria-label="Switch to English"
            >
              EN
            </button>
            <button
              type="button"
              className={`lang-btn ${language === 'hi' ? 'active' : ''}`}
              onClick={() => handleLanguageChange('hi')}
              aria-pressed={language === 'hi'}
              aria-label="Switch to Hindi (हिन्दी)"
            >
              हिन्दी
            </button>
            <button
              type="button"
              className={`lang-btn ${language === 'hinglish' ? 'active' : ''}`}
              onClick={() => handleLanguageChange('hinglish')}
              aria-pressed={language === 'hinglish'}
              aria-label="Switch to Hinglish (मिक्स)"
            >
              Hinglish
            </button>
          </div>

          {/* Quick Sound Toggle Button */}
          <button
            type="button"
            className={`icon-toggle-btn ${!speechEnabled ? 'muted' : ''}`}
            onClick={handleSpeechToggle}
            aria-label={speechEnabled ? 'Mute voice alerts (Alt+M)' : 'Unmute voice alerts (Alt+M)'}
            title="Toggle Voice Alerts (Alt+M)"
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
          <strong>
            {language === 'hi' ? 'सुरक्षा सूचना:' : language === 'hinglish' ? 'Safety Notice:' : 'Safety Advisory:'}
          </strong>{' '}
          {language === 'hi'
            ? 'पैथोरा एआई एक प्रायोगिक सहायता साधन है। यह सफ़ेद छड़ी या गाइड डॉग का विकल्प नहीं है। दूरी अनुमान केवल अनुमानित हैं। दिशाएँ कैमरा-दृश्य के सापेक्ष हैं।'
            : language === 'hinglish'
            ? 'Pathora AI ek experimental prototype hai aur white cane ya mobility aid ka replacement nahi hai. Distance estimates approximate hain aur directions camera view ke hisaab se hain.'
            : 'Pathora AI is experimental and NOT a replacement for a white cane or mobility aid. Distance estimates are approximate — not calibrated measurements. Directions refer to camera view position.'}
        </p>
      </aside>

      {/* Main Action Bar */}
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
            <span>
              {language === 'hi' ? 'सहायता बंद करें' : language === 'hinglish' ? 'Stop Assistance' : 'Stop Assistance'}
            </span>
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
                ? language === 'hi'
                  ? 'मॉडल लोड हो रहा है...'
                  : language === 'hinglish'
                  ? 'AI Model Load ho raha hai...'
                  : 'Loading Model...'
                : status === 'requesting-camera'
                ? language === 'hi'
                  ? 'कैमरा जुड़ रहा है...'
                  : language === 'hinglish'
                  ? 'Camera Open ho raha hai...'
                  : 'Opening Camera...'
                : language === 'hi'
                ? 'सहायता शुरू करें'
                : language === 'hinglish'
                ? 'Start Assistance'
                : 'Start Assistance'}
            </span>
          </button>
        )}
      </nav>

      {/* Quick Voice Actions Bar (Repeat Alert, Test Voice, Voice Toggle) */}
      <section className="voice-actions-toolbar" aria-label="Voice Controls Toolbar">
        <button
          type="button"
          className="btn-voice-tool"
          onClick={handleRepeatAlert}
          aria-label="Repeat last voice alert (Keyboard shortcut: Alt+R)"
          title="Repeat Last Alert (Alt+R)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="1 4 1 10 7 10" />
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
          </svg>
          <span className="btn-tool-text">
            {language === 'hi' ? 'पिछला अलर्ट दोहराएं' : language === 'hinglish' ? 'Repeat Last Alert' : 'Repeat Alert'}
          </span>
          <span className="btn-kbd-hint">Alt+R</span>
        </button>

        <button
          type="button"
          className="btn-voice-tool"
          onClick={handleTestVoice}
          aria-label="Test current voice settings (Keyboard shortcut: Alt+T)"
          title="Test Voice Preview (Alt+T)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          <span className="btn-tool-text">
            {language === 'hi' ? 'आवाज़ का परीक्षण करें' : language === 'hinglish' ? 'Test Voice' : 'Test Voice'}
          </span>
          <span className="btn-kbd-hint">Alt+T</span>
        </button>

        <button
          type="button"
          className={`btn-voice-tool ${!speechEnabled ? 'muted-tool' : ''}`}
          onClick={handleSpeechToggle}
          aria-label={speechEnabled ? 'Mute voice alerts (Alt+M)' : 'Unmute voice alerts (Alt+M)'}
          title="Toggle Voice Alerts (Alt+M)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            {speechEnabled ? (
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
            ) : (
              <line x1="22" y1="9" x2="16" y2="15" />
            )}
          </svg>
          <span className="btn-tool-text">
            {speechEnabled
              ? language === 'hi' ? 'आवाज़ सक्रिय है' : 'Voice Active'
              : language === 'hi' ? 'आवाज़ बंद है' : 'Voice Muted'}
          </span>
          <span className="btn-kbd-hint">Alt+M</span>
        </button>
      </section>

      {/* Error Banner */}
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

      {/* Video & Canvas Stage */}
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
                ? language === 'hi'
                  ? 'आरंभ किया जा रहा है...'
                  : language === 'hinglish'
                  ? 'Camera aur AI engine start ho raha hai...'
                  : 'Initializing camera and AI engine...'
                : language === 'hi'
                ? 'कैमरा फ़ीड देखने के लिए "सहायता शुरू करें" दबाएं'
                : language === 'hinglish'
                ? 'Live camera feed shuru karne ke liye "Start Assistance" dabayein'
                : 'Press "Start Assistance" to activate live camera feed'}
            </p>
          </div>
        )}

        {status === 'active' && (
          <div className="stage-badges" aria-hidden="true">
            <span className="badge active">
              <span className="badge-dot" /> Live
            </span>
            <span className="badge">{fps} FPS</span>
          </div>
        )}
      </section>

      {/* Dashboard Section */}
      <main className="dashboard-grid">
        {/* Live Awareness Card */}
        <section className="card" aria-labelledby="live-status-heading">
          <div className="card-header">
            <h2 id="live-status-heading" className="card-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
              </svg>
              {language === 'hi' ? 'वर्तमान स्थिति' : language === 'hinglish' ? 'Live Awareness' : 'Live Awareness'}
            </h2>
          </div>

          <div
            className={`active-alert-box ${detectedItems.some((i) => i.priority === 'high') ? 'priority-high' : ''}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="alert-label">
              {language === 'hi'
                ? 'वर्तमान उद्घोषणा'
                : language === 'hinglish'
                ? 'Current Announcement'
                : 'Current Announcement'}
            </span>
            <p className="alert-text">{activeAlert}</p>
          </div>

          <div>
            <h3 className="card-title" style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>
              {language === 'hi'
                ? 'पहचाने गए तत्व'
                : language === 'hinglish'
                ? 'Detected Elements'
                : 'Detected Elements'}{' '}
              ({detectedItems.length})
            </h3>
            <div className="detected-list" aria-label="Detected objects list">
              {detectedItems.length === 0 ? (
                <div className="empty-chip-state">
                  {status === 'active'
                    ? language === 'hi'
                      ? 'दृश्य में कोई प्रमुख वस्तु नहीं मिली'
                      : language === 'hinglish'
                      ? 'Saamne koi prominent object nahi dikh raha'
                      : 'No prominent objects detected in frame'
                    : language === 'hi'
                    ? 'सहायता प्रारंभ होने की प्रतीक्षा है'
                    : language === 'hinglish'
                    ? 'Assistance start hone ki wait hai'
                    : 'Waiting for assistance to start'}
                </div>
              ) : (
                detectedItems.map((item) => (
                  <div key={item.id} className={`detected-chip ${item.priority === 'high' ? 'priority-high' : ''}`}>
                    <span>
                      {language === 'hi'
                        ? item.labelHi
                        : language === 'hinglish'
                        ? item.labelHinglish || item.labelEn
                        : item.labelEn}
                    </span>
                    <span className="chip-confidence">{Math.round(item.score * 100)}%</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Voice & Accessibility Settings Card */}
        <section className="card voice-settings-card" aria-labelledby="voice-settings-heading">
          <div className="card-header">
            <h2 id="voice-settings-heading" className="card-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              {language === 'hi'
                ? 'आवाज़ और भाषा सेटिंग्स'
                : language === 'hinglish'
                ? 'Voice & Speech Settings'
                : 'Voice & Speech Settings'}
            </h2>
            <button
              type="button"
              className="btn-toggle-settings"
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              aria-expanded={isSettingsOpen}
              aria-label={isSettingsOpen ? 'Collapse voice settings' : 'Expand voice settings'}
            >
              {isSettingsOpen ? '▲' : '▼'}
            </button>
          </div>

          {isSettingsOpen && (
            <div className="settings-content">
              {/* Language Choice */}
              <div className="setting-group">
                <label className="setting-label">
                  {language === 'hi' ? 'भाषा चुनें:' : language === 'hinglish' ? 'Language chunein:' : 'Language Mode:'}
                </label>
                <div className="lang-buttons-row" role="radiogroup" aria-label="Select voice alert language">
                  <button
                    type="button"
                    className={`btn-choice ${language === 'hi' ? 'selected' : ''}`}
                    onClick={() => handleLanguageChange('hi')}
                    role="radio"
                    aria-checked={language === 'hi'}
                  >
                    <span>हिन्दी</span>
                    <small>सरल व प्राकृतिक</small>
                  </button>
                  <button
                    type="button"
                    className={`btn-choice ${language === 'hinglish' ? 'selected' : ''}`}
                    onClick={() => handleLanguageChange('hinglish')}
                    role="radio"
                    aria-checked={language === 'hinglish'}
                  >
                    <span>Hinglish</span>
                    <small>Everyday Mix</small>
                  </button>
                  <button
                    type="button"
                    className={`btn-choice ${language === 'en' ? 'selected' : ''}`}
                    onClick={() => handleLanguageChange('en')}
                    role="radio"
                    aria-checked={language === 'en'}
                  >
                    <span>English</span>
                    <small>Clear & Simple</small>
                  </button>
                </div>
              </div>

              {/* Voice Selection (if supported by system) */}
              <div className="setting-group">
                <label htmlFor="voice-select" className="setting-label">
                  {language === 'hi'
                    ? 'सिस्टम आवाज़ (Voice):'
                    : language === 'hinglish'
                    ? 'System Voice select karein:'
                    : 'System Voice:'}
                </label>
                <select
                  id="voice-select"
                  className="voice-select-dropdown"
                  value={selectedVoiceURI}
                  onChange={(e) => setSelectedVoiceURI(e.target.value)}
                  aria-label="Select system voice"
                >
                  <option value="">
                    {language === 'hi'
                      ? '★ स्वचालित चयन (सुझाया गया)'
                      : language === 'hinglish'
                      ? '★ Auto-select best voice (Recommended)'
                      : '★ Auto-select best voice (Recommended)'}
                  </option>
                  {matchedVoices.length > 0 ? (
                    <optgroup label="Recommended for current language">
                      {matchedVoices.map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="All System Voices">
                    {availableVoices.map((v) => (
                      <option key={v.voiceURI} value={v.voiceURI}>
                        {v.name} ({v.lang})
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Speaking Speed */}
              <div className="setting-group">
                <label className="setting-label">
                  {language === 'hi'
                    ? 'बोलने की गति (Speed):'
                    : language === 'hinglish'
                    ? 'Speaking speed:'
                    : 'Speaking Speed:'}
                </label>
                <div className="speed-buttons-row" role="radiogroup" aria-label="Select speaking speed">
                  <button
                    type="button"
                    className={`btn-speed ${speechRate === 'slow' ? 'selected' : ''}`}
                    onClick={() => setSpeechRate('slow')}
                    role="radio"
                    aria-checked={speechRate === 'slow'}
                  >
                    {language === 'hi' ? 'धीमी (0.85x)' : 'Slow (0.85x)'}
                  </button>
                  <button
                    type="button"
                    className={`btn-speed ${speechRate === 'normal' ? 'selected' : ''}`}
                    onClick={() => setSpeechRate('normal')}
                    role="radio"
                    aria-checked={speechRate === 'normal'}
                  >
                    {language === 'hi' ? 'सामान्य (1.0x)' : 'Normal (1.0x)'}
                  </button>
                  <button
                    type="button"
                    className={`btn-speed ${speechRate === 'fast' ? 'selected' : ''}`}
                    onClick={() => setSpeechRate('fast')}
                    role="radio"
                    aria-checked={speechRate === 'fast'}
                  >
                    {language === 'hi' ? 'तेज़ (1.25x)' : 'Fast (1.25x)'}
                  </button>
                </div>
              </div>

              {/* Volume Slider */}
              <div className="setting-group">
                <div className="setting-label-row">
                  <label htmlFor="volume-slider" className="setting-label">
                    {language === 'hi'
                      ? 'आवाज़ की तीव्रता (Volume):'
                      : language === 'hinglish'
                      ? 'Voice volume:'
                      : 'Voice Volume:'}
                  </label>
                  <span className="vol-percent">{Math.round(speechVolume * 100)}%</span>
                </div>
                <input
                  id="volume-slider"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={speechVolume}
                  onChange={(e) => setSpeechVolume(parseFloat(e.target.value))}
                  className="volume-slider"
                  aria-label="Adjust voice volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(speechVolume * 100)}
                />
              </div>

              {/* Keyboard accessibility helper */}
              <div className="shortcuts-info">
                <strong>Accessibility Shortcuts:</strong>
                <span>Alt+R: Repeat Alert &bull; Alt+T: Test Voice &bull; Alt+M: Toggle Audio</span>
              </div>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="app-footer" role="contentinfo">
        <p>
          Pathora AI (Prototype) &bull; EfficientDet-Lite0 &bull; Local Speech Synthesis with Hindi, Hinglish & English &bull; 100% On-device Privacy
        </p>
      </footer>
    </div>
  );
};

export default App;
