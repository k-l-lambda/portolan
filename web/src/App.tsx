import { useEffect, useState } from "react";
import { DocView } from "./DocView.tsx";
import { IndexView } from "./IndexView.tsx";
import { rememberRecent } from "./recent.ts";
import { RecentMenu } from "./RecentMenu.tsx";

/** Hash routing: `#/` lists documents, `#/doc/<relative path>[?node=<id>]` opens one. */
function useRoute(): { file: string | null; node: string | null } {
  const read = () => {
    const m = /^#\/doc\/([^?]+)(?:\?node=(.+))?$/.exec(window.location.hash);
    return m ? { file: decodeURIComponent(m[1]!), node: m[2] ? decodeURIComponent(m[2]) : null } : { file: null, node: null };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onHash = () => setRoute(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

export function App() {
  const { file, node } = useRoute();
  useEffect(() => { if (file) rememberRecent(file); }, [file]);
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">Portolan</a>
        {file && (
          <nav aria-label="Breadcrumb" className="crumbs">
            <span aria-hidden="true">/</span> <RecentMenu file={file} />
          </nav>
        )}
      </header>
      {file ? <DocView key={file} file={file} focus={node} /> : <IndexView />}
    </div>
  );
}
