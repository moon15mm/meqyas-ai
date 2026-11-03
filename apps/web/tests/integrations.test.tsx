import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";

import ar from "../messages/ar.json";
import { useSegmentOptions } from "@/components/analytics/segments";
import { InvitationUnavailable } from "@/components/survey/public/public-survey";

function renderAr(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="ar" messages={ar} timeZone="Asia/Riyadh">
      <div dir="rtl">{ui}</div>
    </NextIntlClientProvider>,
  );
}

function SegmentProbe({ store }: { store: boolean }) {
  const options = useSegmentOptions([], { store });
  return (
    <ul>
      {options.meta.map((m) => (
        <li key={m.value}>{m.label}</li>
      ))}
    </ul>
  );
}

describe("store invitation links", () => {
  it("explains a link that was already used instead of reopening the form", () => {
    renderAr(<InvitationUnavailable title="تقييم المنتج" state="used" />);
    expect(screen.getByRole("heading", { name: "شكرًا لك!" })).toBeInTheDocument();
    expect(screen.getByText(/سبق أن قيّمت/)).toBeInTheDocument();
  });

  it("has a message for every non-valid state", () => {
    for (const state of ["expired", "closed", "invalid"] as const) {
      const { unmount } = renderAr(<InvitationUnavailable title="x" state={state} />);
      expect(screen.getByRole("heading")).toHaveTextContent(ar.public.invitation[state].title);
      unmount();
    }
  });
});

describe("analytics breakdowns", () => {
  it("offers product and store breakdowns only once store answers exist", () => {
    const { unmount } = renderAr(<SegmentProbe store={false} />);
    expect(screen.queryByText("المنتج")).not.toBeInTheDocument();
    unmount();
    renderAr(<SegmentProbe store />);
    expect(screen.getByText("المنتج")).toBeInTheDocument();
    expect(screen.getByText("المتجر")).toBeInTheDocument();
  });
});
