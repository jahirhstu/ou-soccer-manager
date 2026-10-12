import { FixtureShareButton } from "@/components/FixtureShareButton";
import { FixtureScheduleView, type FixtureScheduleViewProps } from "@/components/FixtureScheduleView";

export type { FixtureScheduleItem } from "@/components/FixtureScheduleView";

export function FixtureScheduleCard({ canShare = false, ...props }: FixtureScheduleViewProps & { canShare?: boolean }) {
  return (
    <FixtureScheduleView
      {...props}
      actions={canShare && props.matches.length > 0 ? <FixtureShareButton {...props} sessionLabel={props.sessionLabel || "Session"} /> : null}
    />
  );
}
