import { Img, staticFile } from "remotion";

import site from "../data/site.json";
import tests from "../data/tests.json";
import { CUE, SCENES } from "../timeline.js";
import { C, Kicker, MONO, MeqyasMark, Panel, Scene, Title, ramp, rise } from "../ui.jsx";

function Tests({ t }) {
  const [a, b] = SCENES.p4Tests;
  const runStart = a + 2.4;
  const runEnd = b - 2.2;
  const shown = Math.floor(tests.tests.length * ramp(t, runStart, runEnd - runStart));
  const done = t >= runEnd;
  const visible = tests.tests.slice(Math.max(0, shown - 15), shown);
  return (
    <div style={{ position: "absolute", inset: 0, padding: "60px 110px 150px", display: "flex", gap: 60, alignItems: "center" }}>
      <div style={{ width: 520, ...rise(t, a + 0.1) }}>
        <Kicker>Built test-first</Kicker>
        <Title size={70} style={{ marginTop: 16 }}>
          {tests.tests.length} AI tests
        </Title>
        <div style={{ fontSize: 30, color: C.dim, marginTop: 22, lineHeight: 1.6 }}>
          Structured-output repair
          <br />
          Prompt-injection defense
          <br />
          Retention rules
        </div>
      </div>
      <Panel style={{ flex: 1, padding: 0, overflow: "hidden", ...rise(t, a + 0.6) }}>
        <div style={{ padding: "16px 26px", borderBottom: `1px solid ${C.line}`, fontFamily: MONO, fontSize: 22, color: C.dim }}>
          $ {tests.command}
        </div>
        <div style={{ padding: "18px 26px", fontFamily: MONO, fontSize: 19, lineHeight: 1.7, height: 560, overflow: "hidden" }}>
          {visible.map((line) => {
            const [name, status] = line.split(" ");
            return (
              <div key={line} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span style={{ color: C.dim }}>{name.replace("packages/ai/tests/", "")}</span>{" "}
                <span style={{ color: status === "PASSED" ? C.green : C.red, fontWeight: 700 }}>{status}</span>
              </div>
            );
          })}
        </div>
        <div
          style={{
            padding: "18px 26px",
            borderTop: `1px solid ${C.line}`,
            fontFamily: MONO,
            fontSize: 28,
            fontWeight: 700,
            color: done ? C.green : C.dim,
            background: done ? "rgba(52,211,153,.10)" : "transparent",
          }}
        >
          {done ? tests.summary : `running… ${shown}/${tests.tests.length}`}
        </div>
      </Panel>
    </div>
  );
}

function LiveSite({ t }) {
  const [a, b] = SCENES.p4Live;
  const screens = site.screens ?? [];
  const per = screens.length ? (b - a) / screens.length : 1;
  const idx = Math.min(screens.length - 1, Math.floor((t - a) / per));
  const gh = ramp(t, CUE.github, 0.5);
  return (
    <div style={{ position: "absolute", inset: 0, padding: "60px 110px 150px", display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
      <Panel style={{ width: 1500, height: 760, padding: 0, overflow: "hidden", position: "relative", ...rise(t, a) }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 22px", borderBottom: `1px solid ${C.line}` }}>
          <span style={{ width: 13, height: 13, borderRadius: 99, background: "#ff5f57" }} />
          <span style={{ width: 13, height: 13, borderRadius: 99, background: "#febc2e" }} />
          <span style={{ width: 13, height: 13, borderRadius: 99, background: "#28c840" }} />
          <span style={{ marginLeft: 20, padding: "6px 22px", borderRadius: 10, background: "rgba(255,255,255,.06)", fontFamily: MONO, fontSize: 22, color: C.text }}>
            https://meqyas.wardat.xyz
          </span>
        </div>
        {screens.length ? (
          screens.map((s, i) => {
            const local = t - a - i * per;
            const op = i === idx ? ramp(t, a + i * per, 0.4) : 0;
            return (
              <Img
                key={s}
                src={staticFile(s)}
                style={{
                  position: "absolute",
                  top: 60,
                  left: 0,
                  width: "100%",
                  opacity: op,
                  transform: `translateY(${-Math.max(0, local) * 18}px)`,
                }}
              />
            );
          })
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "calc(100% - 60px)", color: C.amber, fontFamily: MONO, fontSize: 30 }}>
            site capture pending — run scripts/capture_site.mjs
          </div>
        )}
        <div
          style={{
            position: "absolute",
            right: 30,
            bottom: 30,
            opacity: gh,
            transform: `translateY(${(1 - gh) * 30}px)`,
            padding: "20px 30px",
            borderRadius: 20,
            background: "rgba(7,11,24,.92)",
            border: `1px solid ${C.line}`,
            display: "flex",
            alignItems: "center",
            gap: 18,
          }}
        >
          <svg width="44" height="44" viewBox="0 0 24 24" fill={C.text} aria-hidden="true">
            <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
          </svg>
          <div>
            <div style={{ fontFamily: MONO, fontSize: 26 }}>github.com/moon15mm/meqyas-ai</div>
            <div style={{ fontSize: 20, color: C.dim }}>Open source · Apache-2.0</div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Tagline({ t }) {
  const [a] = SCENES.p4Tagline;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={rise(t, a + 0.1)}>
        <MeqyasMark size={130} />
      </div>
      <div style={{ ...rise(t, a + 1.1), marginTop: 40, textAlign: "center" }}>
        <Title size={90}>
          Turning a bad moment
          <br />
          into a <span style={{ color: C.teal }}>loyal customer.</span>
        </Title>
      </div>
    </div>
  );
}

function EndCard({ t }) {
  const [a] = SCENES.p4End;
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 30, ...rise(t, a + 0.1) }}>
        <MeqyasMark size={120} />
        <Title size={96}>
          Meqyas <span style={{ color: C.teal }}>AI</span>
        </Title>
      </div>
      <div style={{ ...rise(t, a + 0.6), fontSize: 34, color: C.dim }}>Wardat AI Technologies · Eng. Maher Sulaiman</div>
      <div style={{ ...rise(t, a + 1.0), display: "flex", gap: 50, marginTop: 30, fontFamily: MONO, fontSize: 30 }}>
        <span>meqyas.wardat.xyz</span>
        <span style={{ color: C.faint }}>·</span>
        <span>github.com/moon15mm/meqyas-ai</span>
        <span style={{ color: C.faint }}>·</span>
        <span>contact@wardat.xyz</span>
      </div>
      <div style={{ ...rise(t, a + 1.6), marginTop: 30, fontSize: 28, color: C.indigo }}>Built with Llama</div>
    </div>
  );
}

export function Part4({ t }) {
  return (
    <>
      <Scene t={t} range={SCENES.p4Tests}>
        <Tests t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p4Live}>
        <LiveSite t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p4Tagline}>
        <Tagline t={t} />
      </Scene>
      <Scene t={t} range={SCENES.p4End}>
        <EndCard t={t} />
      </Scene>
    </>
  );
}
