const memory: string[] = [];

export function addMemory(data: string): void {
  memory.push(data);
}

export function searchMemory(query: string): string[] {
  const normalized = query.toLowerCase();
  return memory.filter((item) => item.toLowerCase().includes(normalized));
}

export function listMemory(): string[] {
  return [...memory];
}
