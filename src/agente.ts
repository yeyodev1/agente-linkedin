// Agente que redacta y publica 1 post diario en LinkedIn usando el Claude Agent SDK.
import { readFile, writeFile } from "node:fs/promises";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { publicarPost } from "./linkedin.ts";

type EntradaHistorial = { fecha: string; urn: string; gancho: string; estructura: string; texto: string };

const RUTA_VOZ = "contenido/voz.md";
const RUTA_MATERIAL = "contenido/material.md";
const RUTA_HISTORIAL = "contenido/historial.json";
const DRY_RUN = process.env.DRY_RUN === "1";
const MAX_CARACTERES = 3000; // límite duro de LinkedIn; la voz pide ~1.300

const voz = await readFile(RUTA_VOZ, "utf8");
const material = await readFile(RUTA_MATERIAL, "utf8");
const historial: EntradaHistorial[] = JSON.parse(await readFile(RUTA_HISTORIAL, "utf8"));

avisarSiTokenPorVencer();

// En Actions un secret no definido llega como "" y taparía al otro método de auth.
for (const k of ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) {
  if (process.env[k] === "") delete process.env[k];
}

let publicado: EntradaHistorial | null = null;

const publicar = tool(
  "publicar_post",
  "Publica el post final en el perfil de LinkedIn. Llámala UNA sola vez, con el texto definitivo.",
  {
    texto: z.string().min(200).max(MAX_CARACTERES).describe("Texto completo del post, listo para publicar"),
    gancho: z.string().describe("Tipo de gancho usado, ej. 'confesión de error'"),
    estructura: z.string().describe("Estructura usada, ej. 'tutorial corto'"),
  },
  async ({ texto, gancho, estructura }) => {
    // Diego no usa signos de apertura: se quitan siempre, aunque el modelo los ponga.
    texto = texto.replace(/[¿¡]/g, "");
    if (publicado) {
      return { content: [{ type: "text", text: "Ya se publicó un post en esta ejecución. No publiques otro." }], isError: true };
    }
    const urn = DRY_RUN ? "dry-run" : await publicarPost(texto);
    publicado = { fecha: new Date().toISOString(), urn, gancho, estructura, texto };
    return { content: [{ type: "text", text: `Publicado (${urn}).` }] };
  },
);

const hoy = new Date().toLocaleDateString("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const recientes = historial
  .slice(-15)
  .map((p) => `--- ${p.fecha.slice(0, 10)} · gancho: ${p.gancho} · estructura: ${p.estructura} ---\n${p.texto}`)
  .join("\n\n");

const prompt = `Hoy es ${hoy}. Escribe y publica el post de LinkedIn de hoy. Trabajas solo: Diego no está disponible para responder preguntas.

<voz>
${voz}
</voz>

<material_reciente>
${material}
</material_reciente>

<posts_recientes>
${recientes || "(todavía no hay posts publicados)"}
</posts_recientes>

Cómo hacerlo:
1. Elige el ángulo. Prioriza lo más nuevo de <material_reciente> que todavía no esté contado en <posts_recientes>. Si ya se contó todo, usa el contexto fijo de <voz> desde un ángulo que no se haya usado. Solo hechos que estén en estas fuentes: no inventes cifras, clientes, anécdotas ni resultados.
2. Escoge un gancho y una estructura distintos a los del último post.
3. Escribe el post siguiendo <voz> al pie de la letra.
4. Publícalo con publicar_post (indicando gancho y estructura) y termina.`;

for await (const msg of query({
  prompt,
  options: {
    model: process.env.CLAUDE_MODEL ?? "claude-opus-5-5",
    effort: "high",
    tools: ["WebSearch"],
    mcpServers: { linkedin: createSdkMcpServer({ name: "linkedin", tools: [publicar] }) },
    allowedTools: ["WebSearch", "mcp__linkedin__publicar_post"],
    permissionMode: "dontAsk",
    settingSources: [],
    maxTurns: 20,
  },
})) {
  if (msg.type === "result") {
    console.log(`Resultado: ${msg.subtype} · ${msg.num_turns} turnos · ~$${msg.total_cost_usd.toFixed(3)}`);
    if (msg.subtype === "success" && !publicado) console.log(msg.result);
  }
}

if (!publicado) {
  console.error("El agente terminó sin publicar.");
  process.exit(1);
}

const final: EntradaHistorial = publicado;
console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Post (${final.urn}):\n\n${final.texto}`);
if (!DRY_RUN) {
  historial.push(final);
  await writeFile(RUTA_HISTORIAL, JSON.stringify(historial, null, 2) + "\n");
}

// El token de LinkedIn dura 60 días y no se puede refrescar solo:
// deja un warning visible en GitHub Actions la última semana.
function avisarSiTokenPorVencer() {
  const expira = process.env.LINKEDIN_TOKEN_EXPIRA;
  if (!expira) return;
  const dias = Math.floor((Date.parse(expira) - Date.now()) / 86_400_000);
  if (dias < 0) throw new Error(`El token de LinkedIn venció el ${expira}. Corre: npm run token -- --subir`);
  if (dias <= 7) console.log(`::warning::El token de LinkedIn vence en ${dias} días. Corre: npm run token -- --subir`);
}
