"use client";

import { FixtureScheduleView, type FixtureScheduleViewProps } from "@/components/FixtureScheduleView";
import { ImageShareButton } from "@/components/ImageShareButton";
import { fixtureImageName } from "@/lib/fixture-sharing";

type Props = FixtureScheduleViewProps & { sessionLabel: string };

export function FixtureShareButton(props: Props) {
  return (
    <ImageShareButton title="Share fixture" filename={fixtureImageName(props.sessionLabel, props.sessionDate)} imageAlt={`${props.sessionLabel} complete fixture schedule`}>
      <FixtureImage {...props} />
    </ImageShareButton>
  );
}

export function FixtureImage({ ref, ...props }: Props & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className="bg-white p-4" style={{ width: 1280 }}><FixtureScheduleView {...props} desktop /></div>;
}
