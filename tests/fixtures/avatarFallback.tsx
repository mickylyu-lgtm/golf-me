import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Avatar } from "../../src/components/ui/Avatar";
import "../../src/index.css";
const good = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#246b49"/><circle cx="50" cy="40" r="18" fill="#f5d483"/><path d="M20 95 Q20 60 50 60 Q80 60 80 95" fill="#f5d483"/></svg>');
function Fixture() {
  const [url, setUrl] = useState("/missing-synthetic-avatar.jpg");
  const [clicks, setClicks] = useState(0);
  const golfer = { avatarColor: "from-fairway-500 to-fairway-700", avatarInitials: "TG", verification: { verifiedGolfer: false }, photoUrl: url };
  return <main className="p-8 flex flex-col gap-5"><h1>Synthetic avatar fallback preview</h1><p>Test Golfer · missing photo</p><div data-testid="avatar"><Avatar golfer={golfer} size="xl" magnifyOnTap /></div><button onClick={() => setUrl(good)}>Working photo</button><button onClick={() => setUrl("/missing-second-avatar.jpg")}>Broken photo</button><div data-testid="navigation" onClick={() => setClicks(clicks + 1)}><Avatar golfer={golfer} /></div><p data-testid="clicks">{clicks}</p></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
