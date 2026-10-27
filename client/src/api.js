// Thin fetch wrapper. Throws Error with the Thai message returned by the server.
export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const error = new Error(data?.error || 'เกิดข้อผิดพลาด');
    error.status = res.status;
    throw error;
  }
  return data;
}
