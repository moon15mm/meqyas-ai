import live from "../data/live-run.json";
import { LIVE, SCENES } from "../timeline.js";
import { Arabic, Arrow, C, Kicker, MONO, MeqyasMark, Panel, Pill, Scene, Title, ramp, rise, typed } from "../ui.jsx";

// Every value in the live-run scenes comes from src/data/live-run.json, written by
// scripts/live_run.py against the real model. Until that file exists, fields read “pending”.
const COMPLAINT = live?.complaint ?? null;
const SARCASM = live?.sarcasm ?? null;

const FALLBACK_INPUT = {
  complaint: "والله ما قصرتوا بس الطلب مدهوك، والشوربة كبت في الكيس، والأكل واصل بارد!",
  sarcasm: "ما شاء الله أسرع مطعم في العالم… ساعتين أنتظر الوجبة وجاتني مثلجة!",
};

const pretty = (v) => (typeof v === "string" ? v.replaceAll("_", " ") : v);

function Intro({ t }) {
  const [a] = SCENES.p2Intro;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ transform: `scale(${0.7 + 0.3 * ramp(t, a, 0.8)})`, opacity: ramp(t, a, 0.5) }}>
        <MeqyasMark size={180} arc={ramp(t, a + 0.2, 1.0)} bars={[ramp(t, a + 0.7, 0.5), ramp(t, a + 0.85, 0.5), ramp(t, a + 1.0, 0.5)]} />
      </div>
      <div style={{ ...rise(t, a + 0.6), marginTop: 36 }}>
        <Title size={110}>
          Meqyas <span style={{ color: C.teal }}>AI</span>
        </Title>
      </div>
      <div style={{ ...rise(t, a + 2.0), fontSize: 40, color: C.dim, marginTop: 14 }}>
        Customer intelligence &amp; retention for Arabic commerce
      </div>
      <div style={{ ...rise(t, a + 4.6), marginTop: 40 }}>
        <Pill color={C.indigo} style={{ fontSize: 32, padding: "12px 30px" }}>
          Running on Meta Llama 3
        </Pill>
      </div>
    </div>
  );
}

function Flow({ t }) {
  const [a] = SCENES.p2Flow;
  const steps = [
    ["Complaint arrives", "store · app · WhatsApp", C.red],
    ["CX Retention Agent", "Meta Llama 3", C.indigo],
    ["Structured result", "validated schema", C.teal],
    ["Remedy + reply", "within policy", C.green],
  ];
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
      {steps.map(([h, s, col], i) => (
        <div key={h} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Panel glow={col} style={{ width: 340, padding: "34px 30px", textAlign: "center", ...rise(t, a + i * 0.7) }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: col }}>{h}</div>
            <div style={{ fontSize: 24, color: C.dim, marginTop: 8 }}>{s}</div>
          </Panel>
          {i < steps.length - 1 ? <Arrow width={90} p={ramp(t, a + i * 0.7 + 0.4, 0.5)} /> : null}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value, t, at, color = C.text, mono = true }) {
  const p = ramp(t, at, 0.45);
  const pending = value === undefined || value === null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 24,
        padding: "14px 0",
        borderBottom: `1px solid ${C.line}`,
        opacity: 0.25 + 0.75 * p,
      }}
    >
      <span style={{ fontFamily: MONO, fontSize: 24, color: C.dim }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? MONO : undefined,
          fontSize: 32,
          fontWeight: 600,
          color: pending ? C.amber : color,
          transform: `translateX(${(1 - p) * 20}px)`,
          opacity: p,
          textAlign: "right",
        }}
      >
        {pending ? "pending live run" : String(value)}
      </span>
    </div>
  );
}

function StatusBar({ run, t, active }) {
  const ok = !!run;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 99,
          background: ok ? C.green : C.amber,
          opacity: active ? 0.55 + 0.45 * Math.sin(t * 6) : 1,
        }}
      />
      <span style={{ fontFamily: MONO, fontSize: 24, color: ok ? C.green : C.amber, whiteSpace: "nowrap" }}>
        {ok ? `LIVE · ${run.model}` : "LIVE RUN PENDING"}
      </span>
      {ok && run.latency_ms ? (
        <span style={{ fontFamily: MONO, fontSize: 24, color: C.dim }}>· {(run.latency_ms / 1000).toFixed(2)} s</span>
      ) : null}
    </div>
  );
}

function Live({ t }) {
  const [a] = SCENES.p2Live;
  const sarcasmPhase = t >= LIVE.sarcasm;
  const run = sarcasmPhase ? SARCASM : COMPLAINT;
  const out = run?.output ?? {};
  const input = run?.input ?? {};
  const text = input.feedback_text ?? (sarcasmPhase ? FALLBACK_INPUT.sarcasm : FALLBACK_INPUT.complaint);
  const swap = sarcasmPhase ? ramp(t, LIVE.sarcasm, 0.6) : 1;

  const cues = sarcasmPhase
    ? { send: LIVE.sarcasmText, result: LIVE.sarcasmResult, dialect: LIVE.sarcasmResult, sentiment: LIVE.sarcasmResult + 0.5, rootCause: LIVE.sarcasmResult + 1.0, urgency: LIVE.sarcasmResult + 2.6, churn: LIVE.sarcasmResult + 1.6, remedy: 1e9 }
    : LIVE;
  const sarcasmFlag = sarcasmPhase ? out.sarcasm_detected : out.sarcasm_detected;

  return (
    <div style={{ position: "absolute", inset: 0, padding: "70px 90px 150px", display: "flex", flexDirection: "column", gap: 28 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", ...rise(t, a) }}>
        <div>
          <Kicker>{sarcasmPhase ? "Live run · case 2 · sarcasm" : "Live run · case 1"}</Kicker>
          <div style={{ fontSize: 46, fontWeight: 700, marginTop: 6, whiteSpace: "nowrap" }}>
            CXRetentionAgent{" "}
            <span style={{ color: C.dim, fontWeight: 400, fontFamily: MONO, fontSize: 28 }}>POST /api/v1/cx/retention-analysis</span>
          </div>
        </div>
        <StatusBar run={run} t={t} active={t > cues.send && t < cues.result + 1} />
      </div>

      <div style={{ display: "flex", gap: 36, flex: 1, opacity: swap }}>
        {/* Request */}
        <Panel style={{ flex: 1, padding: "34px 40px", display: "flex", flexDirection: "column", gap: 22 }}>
          <Kicker color={C.dim}>Request</Kicker>
          <Arabic size={44} style={{ minHeight: 140 }}>
            {sarcasmPhase ? typed(text, t, LIVE.sarcasmText, 16) : text}
          </Arabic>
          {sarcasmPhase && t >= LIVE.sarcasmEn ? (
            <div style={{ ...rise(t, LIVE.sarcasmEn), fontSize: 28, color: C.dim, fontStyle: "italic" }}>
              “The fastest restaurant in the world… two hours, and the food arrived frozen.”
            </div>
          ) : null}
          <div style={{ fontFamily: MONO, fontSize: 24, color: C.dim, lineHeight: 1.7, opacity: ramp(t, sarcasmPhase ? LIVE.sarcasmText : LIVE.send, 0.5) }}>
            <div>order_amount: <span style={{ color: C.amber }}>{input.order_amount ?? "—"}</span> SAR</div>
            <div>customer_clv: <span style={{ color: C.amber }}>{input.customer_clv ?? "—"}</span> SAR</div>
            <div>order_count: <span style={{ color: C.amber }}>{input.order_count ?? "—"}</span></div>
            <div>channel: <span style={{ color: "#86efac" }}>"{input.channel ?? "delivery_app"}"</span></div>
          </div>
          {!sarcasmPhase && t >= LIVE.send ? (
            <div style={{ ...rise(t, LIVE.send), marginTop: "auto" }}>
              <Pill color={C.teal}>→ sent to {run?.model ?? "Llama 3.3 70B"}</Pill>
            </div>
          ) : null}
        </Panel>

        {/* Result */}
        <Panel glow={C.teal} style={{ flex: 1.1, padding: "34px 40px", opacity: ramp(t, cues.result - 0.2, 0.5) }}>
          <Kicker color={C.teal}>Structured result</Kicker>
          <div style={{ marginTop: 12 }}>
            <Field label="detected_dialect" value={pretty(out.detected_dialect)} t={t} at={cues.dialect} color={C.teal} />
            <Field label="sentiment" value={out.sentiment && `${pretty(out.sentiment)} (${out.sentiment_score})`} t={t} at={cues.sentiment} color={C.red} />
            {sarcasmPhase ? <Field label="sarcasm_detected" value={sarcasmFlag === undefined ? undefined : String(sarcasmFlag)} t={t} at={cues.sentiment + 0.4} color={C.amber} /> : null}
            <Field label="root_cause" value={pretty(out.root_cause)} t={t} at={cues.rootCause} />
            <Field label="churn_risk_score" value={out.churn_risk_score !== undefined ? `${Math.round(out.churn_risk_score * 100)}%` : undefined} t={t} at={cues.churn} color={C.red} />
            <Field label="urgency" value={pretty(out.urgency)} t={t} at={cues.urgency} color={C.amber} />
            {!sarcasmPhase ? (
              <Field
                label="suggested_action"
                value={out.suggested_action && `${pretty(out.suggested_action)}${out.suggested_compensation_amount ? ` · ${out.suggested_compensation_amount} SAR` : ""}`}
                t={t}
                at={cues.remedy}
                color={C.green}
              />
            ) : null}
          </div>
          {!sarcasmPhase && t >= LIVE.reply ? (
            <div style={{ ...rise(t, LIVE.reply), marginTop: 24, padding: "20px 26px", borderRadius: 20, background: "rgba(52,211,153,.10)", border: `1px solid ${C.green}55` }}>
              <div style={{ fontFamily: MONO, fontSize: 20, color: C.green, marginBottom: 8 }}>customer_response_message</div>
              <Arabic size={30} style={{ lineHeight: 1.6, maxHeight: 150, overflow: "hidden" }}>
                {out.customer_response_message ? typed(out.customer_response_message, t, LIVE.reply + 0.3, 40) : "pending live run"}
              </Arabic>
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

export function Part2({ t }) {
  return (
    <>
      <Scene t={t} range={SCENES.p2Intro}>
        <Intro t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p2Flow}>
        <Flow t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p2Live}>
        <Live t={t} />
      </Scene>
    </>
  );
}
