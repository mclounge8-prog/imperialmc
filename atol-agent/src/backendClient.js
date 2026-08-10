// Тонкий HTTP-клиент к API backend для фискального агента
// (см. backoffice/src/routes/apiFiscal.js).
export class BackendClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = String(baseUrl).replace(/\/$/, '');
    this.token = token;
  }

  async fetchNextJob() {
    const res = await fetch(`${this.baseUrl}/api/fiscal/jobs/next`, {
      headers: { 'X-Agent-Token': this.token },
    });
    if (!res.ok) {
      throw new Error(`Backend вернул ${res.status} на GET /jobs/next`);
    }
    const data = await res.json();
    return data.job;
  }

  async reportResult(jobId, result) {
    const res = await fetch(`${this.baseUrl}/api/fiscal/jobs/${jobId}/result`, {
      method: 'POST',
      headers: { 'X-Agent-Token': this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
    if (!res.ok) {
      throw new Error(`Backend вернул ${res.status} при отправке результата задания ${jobId}`);
    }
  }
}
