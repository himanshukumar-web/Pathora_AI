export type Language = 'en' | 'hi';

export type AlertPriority = 'high' | 'medium' | 'low';

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
  score: number;
  box: BoundingBox;
  priority: AlertPriority;
}

export interface AlertNotification {
  id: string;
  textEn: string;
  textHi: string;
  priority: AlertPriority;
  timestamp: number;
  spoken: boolean;
}

export type AssistanceStatus = 'idle' | 'loading-model' | 'requesting-camera' | 'active' | 'error';
