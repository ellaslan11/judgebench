import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import Demo from "./pages/Demo";
import Failures from "./pages/Failures";
import Findings from "./pages/Findings";
import Home from "./pages/Home";
import Leaderboard from "./pages/Leaderboard";
import Method from "./pages/Method";
import Playground from "./pages/Playground";
import { REPO_PUBLIC, REPO_URL } from "./config";

export default function App() {
  return (
    <HashRouter>
      <header className="nav">
        <NavLink to="/" className="brand">JudgeBench-Code</NavLink>
        <nav>
          <NavLink to="/" end>Demo</NavLink>
          <NavLink to="/overview">Overview</NavLink>
          <NavLink to="/findings">Findings</NavLink>
          <NavLink to="/board">Leaderboard</NavLink>
          <NavLink to="/play">Fool the judge</NavLink>
          <NavLink to="/failures">Failures</NavLink>
          <NavLink to="/method">Method</NavLink>
          {REPO_PUBLIC && <a href={REPO_URL}>GitHub</a>}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Demo />} />
          <Route path="/overview" element={<Home />} />
          <Route path="/findings" element={<Findings />} />
          <Route path="/board" element={<Leaderboard />} />
          <Route path="/play" element={<Playground />} />
          <Route path="/failures" element={<Failures />} />
          <Route path="/method" element={<Method />} />
        </Routes>
      </main>
      <footer className="foot muted small">
        JudgeBench-Code · {REPO_PUBLIC ? <>code, data and every rating at <a href={REPO_URL}>github.com/ellaslan11/judgebench</a>.</> : <>the data behind every chart is in this site; the code is private for now and available on request.</>}{" "}
        Benchmarks the grader, not the agent. No judge here is endorsed as safe.
      </footer>
    </HashRouter>
  );
}
