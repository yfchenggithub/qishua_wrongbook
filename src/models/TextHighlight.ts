export type TextHighlightColor = 'yellow' | 'red' | 'green';

export interface TextHighlightRange {
  start: number;
  end: number;
  color: TextHighlightColor;
}
