import { useEffect, useState } from "react";
import { DEFAULT_FILE } from "./api.ts";
import { DocView } from "./DocView.tsx";
import { GitHubIcon } from "./Icons.tsx";
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

/** The project's home page, linked from the top bar. */
const REPO_URL = "https://github.com/k-l-lambda/portolan";

export function App() {
  const route = useRoute();
  // A static export opens its map directly instead of a one-item index.
  const { file, node } = route.file ? route : { ...route, file: DEFAULT_FILE };
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
        <a className="repo-link" href={REPO_URL} target="_blank" rel="noopener noreferrer"
          title="Portolan on GitHub" aria-label="Portolan on GitHub">
          <GitHubIcon />
        </a>
      </header>
      {file ? <DocView key={file} file={file} focus={node} /> : <IndexView />}
    </div>
  );
}
