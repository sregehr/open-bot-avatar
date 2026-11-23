import { BotAvatar } from "./BotAvatar";
import { Studio } from "./Studio";
import { LOGO, LOGO_COLOR } from "./logo";

/** Where the embed demo (packages/docebo-avatars) is served: its dev server, unless VITE_EMBED_URL names another place. */
const EMBED_URL: string = import.meta.env.VITE_EMBED_URL ?? "http://localhost:5180/";

export function App() {
  return (
    <div className="avatar-studio route-studio">
      <header className="site-top">
        <a className="brand" href="#/" aria-label="Docebo Agent Avatars, home">
          <BotAvatar className="avatar-view brand-avatar" definition={LOGO} color={LOGO_COLOR} depth={10} shading={1} followPointer label="" />
          <span className="brand-name">
            <span className="brand-word">docebo</span>
            <span className="brand-product">Agent Avatars</span>
          </span>
        </a>
        <nav className="site-nav" aria-label="Site">
          <a href={EMBED_URL}>Embed demo</a>
        </nav>
      </header>
      <Studio />
    </div>
  );
}
