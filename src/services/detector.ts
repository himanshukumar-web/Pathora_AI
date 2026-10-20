import { FilesetResolver, ObjectDetector, Detection } from '@mediapipe/tasks-vision';
import { DetectedItem } from '../types';
import { getObjectMeta } from './alertRules';

class DetectorService {
  private detector: ObjectDetector | null = null;
  private isInitializing = false;
  private lastInferenceTime = 0;
  // Throttle inference interval (ms) for battery and low-power phones
  private readonly inferenceIntervalMs = 200; 

  public async initialize(): Promise<void> {
    if (this.detector) return;
    if (this.isInitializing) return;

    this.isInitializing = true;
    try {
      // Attempt local wasm first, fallback to CDN if needed
      let vision;
      try {
        vision = await FilesetResolver.forVisionTasks('/wasm');
      } catch (localWasmErr) {
        console.warn('Local WASM resolver failed, falling back to CDN:', localWasmErr);
        vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
      }

      this.detector = await ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: '/models/efficientdet_lite0.tflite',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        scoreThreshold: 0.40,
        maxResults: 6
      });
    } catch (err) {
      console.error('Failed to initialize MediaPipe Object Detector:', err);
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  public isReady(): boolean {
    return this.detector !== null;
  }

  public detect(video: HTMLVideoElement, timestamp: number): DetectedItem[] {
    if (!this.detector || video.readyState < 2) {
      return [];
    }

    // Throttle inference
    if (timestamp - this.lastInferenceTime < this.inferenceIntervalMs) {
      return [];
    }
    this.lastInferenceTime = timestamp;

    try {
      const result = this.detector.detectForVideo(video, timestamp);
      if (!result || !result.detections) return [];

      return result.detections
        .map((det: Detection, index: number): DetectedItem | null => {
          const topCategory = det.categories?.[0];
          if (!topCategory) return null;

          const meta = getObjectMeta(topCategory.categoryName);
          const box = det.boundingBox || { originX: 0, originY: 0, width: 0, height: 0 };

          return {
            id: `${topCategory.categoryName}-${index}`,
            category: topCategory.categoryName,
            labelEn: meta.en,
            labelHi: meta.hi,
            labelHinglish: meta.hinglish,
            score: topCategory.score,
            box: {
              originX: box.originX,
              originY: box.originY,
              width: box.width,
              height: box.height
            },
            priority: meta.priority
          };
        })
        .filter((item): item is DetectedItem => item !== null)
        .sort((a, b) => {
          // Sort by high priority first, then by score
          if (a.priority === 'high' && b.priority !== 'high') return -1;
          if (b.priority === 'high' && a.priority !== 'high') return 1;
          return b.score - a.score;
        });
    } catch (err) {
      console.warn('Inference error on frame:', err);
      return [];
    }
  }

  public dispose(): void {
    if (this.detector) {
      this.detector.close();
      this.detector = null;
    }
  }
}

export const detectorService = new DetectorService();
