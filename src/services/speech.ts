import { Language } from '../types';

class SpeechService {
  private enabled: boolean = true;
  private currentLanguage: Language = 'en';
  private lastSpokenTime: Record<string, number> = {};
  private minIntervalMs = 3500; // Cooldown per object key to avoid repeat spam
  private lastAnySpeechTime = 0;
  private minGlobalIntervalMs = 1800; // Global cooldown between successive utterances

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setLanguage(lang: Language): void {
    this.currentLanguage = lang;
  }

  public speak(text: string, dedupeKey?: string, force: boolean = false): void {
    if (!this.enabled || !('speechSynthesis' in window)) return;

    const now = Date.now();
    if (!force) {
      if (now - this.lastAnySpeechTime < this.minGlobalIntervalMs) return;
      if (dedupeKey && this.lastSpokenTime[dedupeKey] && now - this.lastSpokenTime[dedupeKey] < this.minIntervalMs) {
        return;
      }
    }

    if (dedupeKey) {
      this.lastSpokenTime[dedupeKey] = now;
    }
    this.lastAnySpeechTime = now;

    window.speechSynthesis.cancel(); // cancel pending queue so speech stays fresh and timely

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05; // slightly brisk for quick screen-reader like feedback
    utterance.pitch = 1.0;

    // Pick best matching voice
    const voices = window.speechSynthesis.getVoices();
    if (this.currentLanguage === 'hi') {
      utterance.lang = 'hi-IN';
      const hiVoice = voices.find(v => v.lang.startsWith('hi'));
      if (hiVoice) utterance.voice = hiVoice;
    } else {
      utterance.lang = 'en-US';
      const enVoice = voices.find(v => v.lang.startsWith('en'));
      if (enVoice) utterance.voice = enVoice;
    }

    window.speechSynthesis.speak(utterance);
  }

  public stop(): void {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

export const speechService = new SpeechService();
