import { useEffect, useState } from "react";
import { DocView } from "./DocView.tsx";
import { IndexView } from "./IndexView.tsx";

/** Hash routing: `#/` lists documents, `#/doc/<relative path>` opens one. */
function useRoute(): string | null {
  const read = () => {
    const m = /^#\/doc\/(.+)$/.exec(window.location.hash);
    return m ? decodeURIComponent(m[1]!) : null;
  };
  const [file, setFile] = useState(read);
  useEffect(() => {
    const onHash = () => setFile(read());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return file;
}

export function App() {
  const file = useRoute();
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">Portolan</a>
        {file && (
          <nav aria-label="Breadcrumb" className="crumbs">
            <span aria-hidden="true">/</span> <span>{file}</span>
          </nav>
        )}
      </header>
      {file ? <DocView key={file} file={file} /> : <IndexView />}
    </div>
  );
}
