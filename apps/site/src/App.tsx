import { BotAvatar } from "./BotAvatar";
import { Studio } from "./Studio";
import { LOGO, LOGO_COLOR } from "./logo";

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
      </header>
      <Studio />
    </div>
  );
}
