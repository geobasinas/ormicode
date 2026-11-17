/** Motion tokens — durations and easings. */

export interface MotionTokens {
  'motion.fast': string; 'motion.normal': string; 'motion.slow': string;
  'ease.standard': string; 'ease.emphasized': string;
}

export const motion: MotionTokens = {
  'motion.fast': '120ms', 'motion.normal': '200ms', 'motion.slow': '320ms',
  'ease.standard': 'cubic-bezier(0.2, 0, 0, 1)', 'ease.emphasized': 'cubic-bezier(0.2, 0, 0, 1.2)',
};
