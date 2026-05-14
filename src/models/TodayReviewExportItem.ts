export type TodayReviewExportItem = {
  mistakeId: string;
  title: string;
  module: string;
  difficulty: number | null;
  currentReviewIndex: number;
  totalReviewCount: number;
  questionImageUri: string | null;
  dueDate: string;
};
