import code from "../data/code.json";
import { CUE, SCENES } from "../timeline.js";
import { Arrow, C, CodeCard, Kicker, MONO, Panel, Pill, Scene, Title, ramp, rise } from "../ui.jsx";

const lineOf = (excerpt, startsWith) =>
  excerpt.first_line + excerpt.lines.findIndex((l) => l.trimStart().startsWith(startsWith));

function Schema({ t }) {
  const [a] = SCENES.p3Schema;
  const ex = code.schema;
  const first = ex.first_line + 3;
  return (
    <div style={{ position: "absolute", inset: 0, padding: "70px 110px 150px", display: "flex", gap: 70, alignItems: "center" }}>
      <div style={{ width: 560, ...rise(t, a + 0.2) }}>
        <Kicker>Under the hood</Kicker>
        <Title size={70} style={{ marginTop: 16 }}>
          A strict <span style={{ color: C.teal }}>Pydantic</span> contract for every agent
        </Title>
        <div style={{ fontSize: 30, color: C.dim, marginTop: 24, lineHeight: 1.5 }}>
          Typed fields, enums and ranges — <span style={{ fontFamily: MONO, color: C.text }}>extra="forbid"</span>.
        </div>
      </div>
      <CodeCard
        excerpt={ex}
        t={t}
        appear={a + 0.3}
        fontSize={21}
        style={{ flex: 1 }}
        highlight={[{ from: first, to: first + 10, at: a + 2.6 }]}
      />
    </div>
  );
}

function Repair({ t }) {
  const [a] = SCENES.p3Repair;
  const nodes = [
    ["Llama 3 output", C.indigo],
    ["Schema check", C.amber],
    ["Repair request", C.red],
    ["Valid result → merchant", C.green],
  ];
  const bad = ramp(t, a + 1.6, 0.4);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 60 }}>
      <div style={{ ...rise(t, a), textAlign: "center" }}>
        <Title size={72}>
          Invalid output? <span style={{ color: C.teal }}>Repaired before it ships.</span>
        </Title>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {nodes.map(([label, col], i) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Panel glow={col} style={{ padding: "30px 34px", fontSize: 32, fontWeight: 700, color: col, ...rise(t, a + 0.5 + i * 0.9) }}>
              {label}
              {i === 1 ? (
                <div style={{ fontFamily: MONO, fontSize: 22, color: C.red, marginTop: 8, opacity: bad }}>✕ urgency: "very bad"</div>
              ) : null}
              {i === 2 ? <div style={{ fontFamily: MONO, fontSize: 22, color: C.dim, marginTop: 8 }}>up to 2 retries</div> : null}
            </Panel>
            {i < nodes.length - 1 ? <Arrow width={80} p={ramp(t, a + 0.9 + i * 0.9, 0.5)} color={col} /> : null}
          </div>
        ))}
      </div>
      <div style={{ ...rise(t, a + 4.2), fontFamily: MONO, fontSize: 24, color: C.dim }}>
        packages/ai/meqyas_ai/agents/base.py · max_repairs = 2
      </div>
    </div>
  );
}

function Rails({ t }) {
  const [a] = SCENES.p3Rails;
  const ex = code.post_process;
  const clampFrom = lineOf(ex, "if clv < 500.0");
  const posFrom = lineOf(ex, "if output.sentiment == SentimentLabel.POSITIVE");
  return (
    <div style={{ position: "absolute", inset: 0, padding: "60px 110px 150px", display: "flex", gap: 60, alignItems: "center" }}>
      <div style={{ width: 520 }}>
        <div style={rise(t, a + 0.2)}>
          <Kicker>Deterministic safety rails</Kicker>
          <Title size={64} style={{ marginTop: 16 }}>
            Rules the model <span style={{ color: C.amber }}>can’t talk its way past</span>
          </Title>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 36 }}>
          <div style={rise(t, CUE.railClamp)}>
            <Pill color={C.teal} style={{ fontSize: 26, whiteSpace: "normal" }}>Compensation ≤ order value for new customers</Pill>
          </div>
          <div style={rise(t, CUE.railPositive)}>
            <Pill color={C.green} style={{ fontSize: 26, whiteSpace: "normal" }}>Positive feedback → no payout</Pill>
          </div>
        </div>
      </div>
      <CodeCard
        excerpt={ex}
        t={t}
        appear={a + 0.3}
        fontSize={20}
        style={{ flex: 1 }}
        dimOthers
        highlight={[
          { from: clampFrom, to: clampFrom + 2, at: CUE.railClamp },
          { from: posFrom, to: posFrom + 7, at: CUE.railPositive },
        ]}
      />
    </div>
  );
}

function Why({ t }) {
  const [a] = SCENES.p3Why;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 50 }}>
      <div style={{ ...rise(t, a + 0.1), textAlign: "center" }}>
        <Kicker color={C.indigo}>Why Meta open weights?</Kicker>
        <Title size={92} style={{ marginTop: 20 }}>
          Data residency <span style={{ color: C.teal }}>matters.</span>
        </Title>
      </div>
      <Panel glow={C.indigo} style={{ padding: "34px 50px", display: "flex", alignItems: "center", gap: 34, ...rise(t, a + 1.9) }}>
        <svg width="76" height="76" viewBox="0 0 24 24" fill="none" stroke={C.teal} strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z" />
          <path d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
        <div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>Saudi Personal Data Protection Law</div>
          <div style={{ fontSize: 28, color: C.dim, marginTop: 6 }}>PDPL · customer messages are personal data</div>
        </div>
      </Panel>
    </div>
  );
}

function OnPrem({ t }) {
  const [a] = SCENES.p3OnPrem;
  const ex = code.tiers;
  const ollama = lineOf(ex, '"ollama"');
  const travel = ramp(t, a + 2.2, 1.6);
  return (
    <div style={{ position: "absolute", inset: 0, padding: "60px 100px 150px", display: "flex", gap: 50, alignItems: "center" }}>
      <div style={{ flex: 1.15, position: "relative", height: 640 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 36,
            border: `3px dashed ${C.teal}`,
            background: "rgba(34,184,207,.05)",
            ...rise(t, a + 0.1),
          }}
        />
        <div style={{ position: "absolute", top: 24, left: 36, ...rise(t, a + 0.3) }}>
          <Kicker>Merchant’s own infrastructure</Kicker>
        </div>
        <Panel style={{ position: "absolute", left: 60, top: 140, width: 330, padding: 30, ...rise(t, a + 0.6) }}>
          <div style={{ fontSize: 34, fontWeight: 700 }}>Meqyas API</div>
          <div style={{ fontSize: 24, color: C.dim, marginTop: 8 }}>CX Retention Agent</div>
        </Panel>
        <Panel glow={C.indigo} style={{ position: "absolute", right: 60, top: 140, width: 400, padding: 30, ...rise(t, a + 1.0) }}>
          <div style={{ fontSize: 34, fontWeight: 700, color: C.indigo }}>Ollama / vLLM</div>
          <div style={{ fontSize: 26, color: C.text, marginTop: 10 }}>Llama 3.3 70B · smart tier</div>
          <div style={{ fontSize: 26, color: C.text, marginTop: 4 }}>Llama 3.2 3B · fast tier</div>
        </Panel>
        {/* message travelling between the two, never crossing the boundary */}
        <div
          style={{
            position: "absolute",
            top: 225,
            left: 400 + travel * 160,
            width: 54,
            height: 40,
            borderRadius: 10,
            background: C.amber,
            opacity: ramp(t, a + 2.0, 0.3) * (1 - ramp(t, a + 3.9, 0.3)),
          }}
        />
        <div style={{ position: "absolute", left: 60, right: 60, bottom: 60, display: "flex", alignItems: "center", gap: 26, ...rise(t, a + 4.2) }}>
          <span style={{ fontSize: 60, color: C.red, fontWeight: 700 }}>✕</span>
          <div style={{ fontSize: 34, fontWeight: 600 }}>
            Customer messages <span style={{ color: C.teal }}>never have to leave</span> the merchant’s infrastructure.
          </div>
        </div>
      </div>
      <CodeCard
        excerpt={ex}
        t={t}
        appear={a + 1.4}
        fontSize={18}
        style={{ flex: 1 }}
        dimOthers
        highlight={[{ from: ollama, to: ollama + 1, at: a + 3.0 }]}
      />
    </div>
  );
}

export function Part3({ t }) {
  return (
    <>
      <Scene t={t} range={SCENES.p3Schema}>
        <Schema t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p3Repair}>
        <Repair t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p3Rails}>
        <Rails t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p3Why}>
        <Why t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p3OnPrem}>
        <OnPrem t={t} />
      </Scene>
    </>
  );
}
