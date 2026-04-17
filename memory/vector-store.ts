export type MemoryRecord = {
  id: string;
  text: string;
  tags: string[];
};

const records: MemoryRecord[] = [];

export function addRecord(record: MemoryRecord): void {
  records.push(record);
}

export function searchByKeyword(query: string): MemoryRecord[] {
  const q = query.toLowerCase();
  return records.filter(
    (r) => r.text.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q))
  );
}
