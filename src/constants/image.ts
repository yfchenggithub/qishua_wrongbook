import type { LocalImageType } from '@/src/models/LocalImage';

export const IMAGE_ROOT_DIR_NAME = 'qishua_wrongbook';
export const MISTAKE_IMAGE_DIR_NAME = 'mistakes';

export const IMAGE_FILE_PREFIX: Record<LocalImageType, string> = {
  question: 'question',
  my_solution: 'my_solution',
  answer: 'answer',
  review_solution: 'review',
};

export const IMAGE_FILE_EXTENSION = 'jpg';
export const IMAGE_QUALITY = 0.85;
export const IMAGE_MAX_WIDTH = 1800;
export const IMAGE_MAX_HEIGHT = 2400;
export const IMAGE_BATCH_CONCURRENCY = 2;
