import { CUE, SCENES } from "../timeline.js";
import { Arabic, C, Kicker, MONO, Panel, Pill, Scene, Title, ramp, rise, typed } from "../ui.jsx";

const COMPLAINT = "والله ما قصرتوا بس الطلب مدهوك، والشوربة كبت في الكيس، والأكل واصل بارد!";
const COMPLAINT_EN = "“Honestly, you did great — but the order was crushed, the soup spilled in the bag, and the food arrived cold!”";

function Avatars({ t, a }) {
  // Illustrative only: a row of customers; some quietly leave.
  const leaving = [2, 5, 7];
  return (
    <div style={{ display: "flex", gap: 34, marginTop: 70 }}>
      {Array.from({ length: 9 }, (_, i) => {
        const appear = ramp(t, a + i * 0.08, 0.5);
        const gone = leaving.includes(i) ? ramp(t, a + 2.2 + leaving.indexOf(i) * 0.45, 0.8) : 0;
        return (
          <div
            key={i}
            style={{
              width: 92,
              height: 92,
              borderRadius: 99,
              background: gone > 0 ? `rgba(251,113,133,${0.25 * (1 - gone)})` : "rgba(109,114,246,.22)",
              border: `2px solid ${gone > 0 ? C.red : C.indigo}`,
              opacity: appear * (1 - gone * 0.85),
              transform: `translateY(${gone * 60}px) scale(${1 - gone * 0.2})`,
              display: "grid",
              placeItems: "center",
            }}
          >
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke={gone > 0 ? C.red : C.text} strokeWidth="1.8">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

function Fragile({ t }) {
  const [a] = SCENES.p1Fragile;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={rise(t, a + 0.4)}>
        <Kicker>GCC e-commerce</Kicker>
      </div>
      <div style={{ ...rise(t, a + 0.9), marginTop: 22, textAlign: "center" }}>
        <Title size={96}>
          Customer retention is <span style={{ color: C.red }}>fragile.</span>
        </Title>
      </div>
      <Avatars t={t} a={a + 1.4} />
    </div>
  );
}

function Hours({ t }) {
  const [a] = SCENES.p1Hours;
  const hours = Math.min(3, Math.floor(Math.max(0, t - a - 1.5) / 0.9));
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 70 }}>
      <Panel style={{ width: 640, padding: 40, ...rise(t, a + 0.2) }}>
        <div style={{ fontFamily: MONO, fontSize: 22, color: C.dim }}>ORDER · DELIVERED</div>
        <div style={{ fontSize: 44, fontWeight: 700, marginTop: 10 }}>Dinner for four</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 30 }}>
          <div style={rise(t, a + 0.8)}>
            <Pill color={C.red}>Damaged packaging</Pill>
          </div>
          <div style={rise(t, a + 1.2)}>
            <Pill color={C.amber}>Arrived late &amp; cold</Pill>
          </div>
        </div>
      </Panel>
      <Panel style={{ width: 640, padding: 40, ...rise(t, a + 0.6) }}>
        <div style={{ fontFamily: MONO, fontSize: 22, color: C.dim }}>SUPPORT CHAT</div>
        <div style={{ display: "flex", alignItems: "center", gap: 22, marginTop: 26 }}>
          <svg width="96" height="96" viewBox="0 0 48 48" aria-hidden="true">
            <circle cx="24" cy="24" r="20" fill="none" stroke={C.line} strokeWidth="4" />
            <circle cx="24" cy="24" r="20" fill="none" stroke={C.amber} strokeWidth="4" strokeLinecap="round" pathLength="1" strokeDasharray={`${((t - a) / 5) % 1} 1`} transform="rotate(-90 24 24)" />
            <line x1="24" y1="24" x2="24" y2="12" stroke={C.text} strokeWidth="3" strokeLinecap="round" transform={`rotate(${(t - a) * 140} 24 24)`} />
          </svg>
          <div>
            <div style={{ fontSize: 40, fontWeight: 700 }}>Waiting for a reply…</div>
            <div style={{ fontSize: 30, color: C.amber, marginTop: 6 }}>{hours > 0 ? `${hours} h and counting` : "just now"}</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Dialects({ t }) {
  const [a] = SCENES.p1Dialects;
  const chips = ["Najdi", "Hijazi", "Eastern", "Southern", "Gulf"];
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...rise(t, a + 0.2), textAlign: "center" }}>
        <Title size={84}>
          Generic sentiment tools <br />
          <span style={{ color: C.amber }}>struggle with Gulf &amp; Saudi dialects.</span>
        </Title>
      </div>
      <div style={{ display: "flex", gap: 22, marginTop: 60 }}>
        {chips.map((c, i) => (
          <div key={c} style={rise(t, a + 0.9 + i * 0.18)}>
            <Pill color={C.teal} style={{ fontSize: 32, padding: "12px 28px" }}>
              {c}
            </Pill>
          </div>
        ))}
      </div>
    </div>
  );
}

function PostCard({ t, a, text, style, highlight = 0 }) {
  const shown = typed(text, t, a, 16);
  // Highlight the phrase “ما قصرتوا” once typed.
  const phrase = "ما قصرتوا";
  const idx = shown.indexOf(phrase);
  return (
    <Panel style={{ width: 1320, padding: "40px 54px", ...style }} glow={C.red}>
      <div style={{ display: "flex", alignItems: "center", gap: 18, marginBottom: 18 }}>
        <div style={{ width: 64, height: 64, borderRadius: 99, background: "linear-gradient(135deg,#f59e0b,#ef4444)" }} />
        <div>
          <div style={{ fontSize: 30, fontWeight: 700 }}>Customer</div>
          <div style={{ fontSize: 22, color: C.dim, fontFamily: MONO }}>@customer · just now</div>
        </div>
      </div>
      <Arabic size={58}>
        {idx >= 0 ? (
          <>
            {shown.slice(0, idx)}
            <span style={{ background: `rgba(251,191,36,${0.35 * highlight})`, borderRadius: 10, padding: "0 6px" }}>{phrase}</span>
            {shown.slice(idx + phrase.length)}
          </>
        ) : (
          shown
        )}
      </Arabic>
    </Panel>
  );
}

function Message({ t }) {
  const [a] = SCENES.p1Message;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 40 }}>
      <div style={rise(t, a)}>
        <PostCard t={t} a={a + 0.2} text={COMPLAINT} />
      </div>
      <div style={{ ...rise(t, a + 3.0), fontSize: 34, color: C.dim, maxWidth: 1320, textAlign: "center", fontStyle: "italic" }}>{COMPLAINT_EN}</div>
    </div>
  );
}

function Generic({ t }) {
  const [a] = SCENES.p1Generic;
  const pos = ramp(t, CUE.genericPositive, 0.5);
  const miss = ramp(t, CUE.genericMissed, 0.5);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 50 }}>
      <PostCard t={t} a={a - 30} text={COMPLAINT} highlight={ramp(t, a + 0.6, 0.5)} />
      <div style={{ display: "flex", alignItems: "center", gap: 40, ...rise(t, a + 1.2) }}>
        <Panel style={{ padding: "26px 40px", display: "flex", alignItems: "center", gap: 26 }}>
          <span style={{ fontFamily: MONO, fontSize: 24, color: C.dim }}>generic keyword model</span>
          <span style={{ fontSize: 30, color: C.dim }}>“<bdi dir="rtl">ما قصرتوا</bdi>” = “you did great” →</span>
          <span style={{ opacity: pos, transform: `scale(${0.8 + 0.2 * pos})`, position: "relative" }}>
            <Pill color={C.green} style={{ fontSize: 34, padding: "10px 26px" }}>
              POSITIVE
            </Pill>
            <span
              style={{
                position: "absolute",
                left: -10,
                right: -10,
                top: "50%",
                height: 6,
                background: C.red,
                borderRadius: 4,
                transform: `scaleX(${miss})`,
                transformOrigin: "left",
              }}
            />
          </span>
        </Panel>
      </div>
      <div style={{ ...rise(t, CUE.genericMissed + 0.2), fontSize: 46, fontWeight: 700, color: C.red }}>Missed: the meal was ruined.</div>
    </div>
  );
}

function Gone({ t }) {
  const [a] = SCENES.p1Gone;
  const leave = ramp(t, a + 1.0, 1.6);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ ...rise(t, a + 0.2), textAlign: "center" }}>
        <Title size={88}>
          By the time someone replies…
          <br />
          <span style={{ color: C.red, opacity: ramp(t, a + 1.4, 0.6) }}>the customer is gone.</span>
        </Title>
      </div>
      <div
        style={{
          marginTop: 70,
          width: 110,
          height: 110,
          borderRadius: 99,
          border: `3px solid ${C.red}`,
          opacity: 1 - leave,
          transform: `translateX(${leave * 500}px)`,
        }}
      />
    </div>
  );
}

export function Part1({ t }) {
  return (
    <>
      <Scene t={t} range={SCENES.p1Fragile}>
        <Fragile t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p1Hours}>
        <Hours t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p1Dialects}>
        <Dialects t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p1Message}>
        <Message t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p1Generic}>
        <Generic t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p1Gone}>
        <Gone t={t} />
      </Scene>
    </>
  );
}
