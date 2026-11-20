import { CaddieNavIcon } from "../icons/CaddieNavIcon";
import "./CaddieWaitScene.css";

// Decorative artwork only. The persisted stage is announced below the panel.
export function CaddieWaitScene() {
  return (
    <div className="relative isolate grid aspect-video place-items-center overflow-hidden bg-brand-forest-deep" aria-hidden="true">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,#2a6744_0%,transparent_72%)]" />
      <div className="grid size-26 place-items-center rounded-[2rem] border border-white/30 bg-fairway-50 text-fairway-800 shadow-lg">
        <CaddieNavIcon size={76} />
      </div>
    </div>
  );
}
