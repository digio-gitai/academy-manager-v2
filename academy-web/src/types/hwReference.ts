export interface ReferenceMaterial {
  id: string;
  classId: string;
  materialName: string;
  fileName: string;
  pageOffset: number; // 0-indexed. 화면에는 항상 +1(몇 번째 장인지)로 보여줌.
  uploadedAt: string;
}
