/** Download an array of rows as a CSV file (client-side, no dependency). */
export function downloadCsv(name: string, header: string[], rows: (string | number)[][]): void {
  const esc = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"';
  const csv = [header.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
