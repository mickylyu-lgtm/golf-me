import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ForceLocale } from "./i18n/LocaleContext";
import { Welcome } from "./pages/Welcome";

// Server-side entry used ONLY by scripts/prerender-landing.mjs at build
// time (never imported by the browser bundle). It renders the public
// landing page to a plain HTML string so dist/index.html carries real,
// crawlable content instead of an empty #root. Deliberately minimal:
//   - MemoryRouter gives useNavigate()/Link a router without a DOM;
//   - ForceLocale pins English (LocaleProvider reads localStorage/navigator
//     and waits for a dictionary; neither exists here);
//   - no AuthProvider/DataProvider — Welcome reads no user state, and the
//     one network hook it has (FoundingCounter) runs in an effect, which
//     renderToString never executes.
export function render(): string {
  return renderToString(
    <MemoryRouter initialEntries={["/welcome"]}>
      <ForceLocale locale="en">
        <Welcome />
      </ForceLocale>
    </MemoryRouter>,
  );
}
