import { Language, AlertPriority, SpeechRate, VoiceOption } from '../types';

const RATE_MAP: Record<SpeechRate, number> = {
  slow: 0.85,
  normal: 1.05,
  fast: 1.25,
};

class SpeechService {
  private enabled: boolean = true;
  private currentLanguage: Language = 'en';
  private currentRate: SpeechRate = 'normal';
  private currentVolume: number = 1.0;
  private selectedVoiceURI: string | null = null;

  private lastSpokenTime: Record<string, number> = {};
  private minIntervalMs = 3500;
  private minHighPriorityIntervalMs = 2000;
  private lastAnySpeechTime = 0;
  private minGlobalIntervalMs = 1500;
  private isSpeaking = false;
  private currentSpokenPriority: AlertPriority = 'low';

  private lastSpokenText: string = '';
  private voicesLoaded = false;
  private voiceListeners: Array<(voices: VoiceOption[]) => void> = [];

  constructor() {
    // Load persisted preferences
    try {
      const savedLang = localStorage.getItem('pathora_language');
      if (savedLang === 'en' || savedLang === 'hi' || savedLang === 'hinglish') {
        this.currentLanguage = savedLang;
      }
      const savedRate = localStorage.getItem('pathora_speech_rate');
      if (savedRate === 'slow' || savedRate === 'normal' || savedRate === 'fast') {
        this.currentRate = savedRate;
      }
      const savedVol = localStorage.getItem('pathora_speech_volume');
      if (savedVol !== null) {
        const v = parseFloat(savedVol);
        if (!isNaN(v) && v >= 0 && v <= 1) this.currentVolume = v;
      }
      const savedVoice = localStorage.getItem('pathora_speech_voice');
      if (savedVoice) this.selectedVoiceURI = savedVoice;

      const savedEnabled = localStorage.getItem('pathora_speech_enabled');
      if (savedEnabled !== null) {
        this.enabled = savedEnabled !== 'false';
      }
    } catch {
      // LocalStorage access might fail in restricted sandboxes
    }

    // Preload voices
    if ('speechSynthesis' in window) {
      const checkVoices = () => {
        const list = window.speechSynthesis.getVoices();
        if (list.length > 0) {
          this.voicesLoaded = true;
          this.notifyVoiceListeners();
        }
      };
      checkVoices();
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        this.voicesLoaded = true;
        this.notifyVoiceListeners();
      });
    }
  }

  public getAvailableVoices(): VoiceOption[] {
    if (!('speechSynthesis' in window)) return [];
    const list = window.speechSynthesis.getVoices();
    return list.map(v => ({
      name: v.name,
      lang: v.lang,
      voiceURI: v.voiceURI,
      isDefault: v.default,
    }));
  }

  public onVoicesChanged(listener: (voices: VoiceOption[]) => void): () => void {
    this.voiceListeners.push(listener);
    if (this.voicesLoaded) {
      listener(this.getAvailableVoices());
    }
    return () => {
      this.voiceListeners = this.voiceListeners.filter(l => l !== listener);
    };
  }

  private notifyVoiceListeners(): void {
    const voices = this.getAvailableVoices();
    this.voiceListeners.forEach(listener => listener(voices));
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    try {
      localStorage.setItem('pathora_speech_enabled', String(enabled));
    } catch { /* ignore */ }

    if (!enabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setLanguage(lang: Language): void {
    this.currentLanguage = lang;
    try {
      localStorage.setItem('pathora_language', lang);
    } catch { /* ignore */ }
  }

  public getLanguage(): Language {
    return this.currentLanguage;
  }

  public setRate(rate: SpeechRate): void {
    this.currentRate = rate;
    try {
      localStorage.setItem('pathora_speech_rate', rate);
    } catch { /* ignore */ }
  }

  public getRate(): SpeechRate {
    return this.currentRate;
  }

  public setVolume(volume: number): void {
    this.currentVolume = Math.max(0, Math.min(1, volume));
    try {
      localStorage.setItem('pathora_speech_volume', String(this.currentVolume));
    } catch { /* ignore */ }
  }

  public getVolume(): number {
    return this.currentVolume;
  }

  public setVoice(voiceURI: string | null): void {
    this.selectedVoiceURI = voiceURI;
    try {
      if (voiceURI) {
        localStorage.setItem('pathora_speech_voice', voiceURI);
      } else {
        localStorage.removeItem('pathora_speech_voice');
      }
    } catch { /* ignore */ }
  }

  public getSelectedVoiceURI(): string | null {
    return this.selectedVoiceURI;
  }

  public getLastSpokenText(): string {
    return this.lastSpokenText;
  }

  /**
   * Intelligently selects the best voice for the given language and preferences.
   */
  public selectAppropriateVoice(lang: Language): SpeechSynthesisVoice | null {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return null;

    // 1. If user has chosen a specific voice URI and it exists
    if (this.selectedVoiceURI) {
      const match = voices.find(v => v.voiceURI === this.selectedVoiceURI);
      if (match) return match;
    }

    // 2. Intelligent selection based on language mode:
    if (lang === 'hi') {
      // Find Hindi voice
      const hiVoice = voices.find(v => v.lang.toLowerCase().startsWith('hi'));
      if (hiVoice) return hiVoice;
      // Fallback: Indian English voice (often understands Hindi phonetics)
      const inVoice = voices.find(v => v.lang.toLowerCase() === 'en-in');
      if (inVoice) return inVoice;
    } else if (lang === 'hinglish') {
      // For Hinglish, Indian English voice is ideal (en-IN)
      const inVoice = voices.find(v => v.lang.toLowerCase() === 'en-in');
      if (inVoice) return inVoice;
      // Next best: Hindi voice
      const hiVoice = voices.find(v => v.lang.toLowerCase().startsWith('hi'));
      if (hiVoice) return hiVoice;
      // Fallback: clear English voice
      const enVoice = voices.find(v => v.lang.toLowerCase().startsWith('en'));
      if (enVoice) return enVoice;
    } else {
      // English: prefer natural English voices
      const enVoice = voices.find(v => v.lang.toLowerCase().startsWith('en'));
      if (enVoice) return enVoice;
    }

    // Default fallback
    return voices.find(v => v.default) || voices[0] || null;
  }

  /**
   * Main speech output method with deduplication, cooldowns, and priority handling.
   */
  public speak(
    text: string,
    dedupeKey?: string,
    force: boolean = false,
    priority: AlertPriority = 'medium'
  ): void {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    if (!text || !text.trim()) return;

    const now = Date.now();
    const interval = priority === 'high' ? this.minHighPriorityIntervalMs : this.minIntervalMs;

    if (!force) {
      // Global throttle between utterances
      if (now - this.lastAnySpeechTime < this.minGlobalIntervalMs) return;

      // Deduplication cooldown for the same object/position
      if (dedupeKey && this.lastSpokenTime[dedupeKey] && now - this.lastSpokenTime[dedupeKey] < interval) {
        return;
      }
    }

    // Priority interruption:
    // If an urgent (high) alert arrives while speaking a low/medium alert, interrupt cleanly
    if (priority === 'high' && this.isSpeaking && this.currentSpokenPriority !== 'high') {
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
    } else if (this.isSpeaking && !force && priority !== 'high') {
      // Don't interrupt currently speaking utterance with lower priority
      return;
    }

    if (dedupeKey) {
      this.lastSpokenTime[dedupeKey] = now;
    }
    this.lastAnySpeechTime = now;
    this.lastSpokenText = text;
    this.currentSpokenPriority = priority;

    // Clear stale queue so speech stays relevant
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = RATE_MAP[this.currentRate];
    utterance.pitch = 1.0;
    utterance.volume = this.currentVolume;

    const matchedVoice = this.selectAppropriateVoice(this.currentLanguage);
    if (matchedVoice) {
      utterance.voice = matchedVoice;
      utterance.lang = matchedVoice.lang;
    } else {
      utterance.lang = this.currentLanguage === 'hi' ? 'hi-IN' : 'en-US';
    }

    utterance.onstart = () => {
      this.isSpeaking = true;
    };

    utterance.onend = () => {
      this.isSpeaking = false;
    };

    utterance.onerror = (e) => {
      this.isSpeaking = false;
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('Speech synthesis error:', e.error);
      }
    };

    // Chrome bug workaround: long-idle synth needs a resume kick
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  }

  public repeatLastAlert(): boolean {
    if (!this.lastSpokenText) return false;
    this.speak(this.lastSpokenText, undefined, true, 'high');
    return true;
  }

  public stop(): void {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isSpeaking = false;
  }

  public resetCooldowns(): void {
    this.lastSpokenTime = {};
    this.lastAnySpeechTime = 0;
    this.isSpeaking = false;
  }
}

export const speechService = new SpeechService();
