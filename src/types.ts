export type Language = 'en' | 'hi' | 'hinglish';

export type AlertPriority = 'high' | 'medium' | 'low';

export type SpeechRate = 'slow' | 'normal' | 'fast';

export interface BoundingBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface DetectedItem {
  id: string;
  category: string;
  labelEn: string;
  labelHi: string;
  labelHinglish: string;
  score: number;
  box: BoundingBox;
  priority: AlertPriority;
}

export interface AlertNotification {
  id: string;
  textEn: string;
  textHi: string;
  textHinglish: string;
  priority: AlertPriority;
  timestamp: number;
  spoken: boolean;
}

export type AssistanceStatus = 'idle' | 'loading-model' | 'requesting-camera' | 'active' | 'error';

export interface VoiceOption {
  name: string;
  lang: string;
  voiceURI: string;
  isDefault: boolean;
}
