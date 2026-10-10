// Dispara el workflow de GitHub a la hora exacta. Los horarios de GitHub Actions
// se atrasan o se saltan; una ejecución lanzada por API arranca al instante.
interface Env {
  GH_TOKEN_DISPARO: string;
}

const WORKFLOW = "https://api.github.com/repos/yeyodev1/agente-linkedin/actions/workflows/publicar.yml/dispatches";

export default {
  async scheduled(_evento: unknown, env: Env) {
    const res = await fetch(WORKFLOW, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_TOKEN_DISPARO}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "disparador-agente-linkedin",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (res.status !== 204) throw new Error(`GitHub respondió ${res.status}: ${await res.text()}`);
  },
};
