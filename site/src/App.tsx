import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import Failures from "./pages/Failures";
import Findings from "./pages/Findings";
import Home from "./pages/Home";
import Leaderboard from "./pages/Leaderboard";
import Method from "./pages/Method";
import Playground from "./pages/Playground";

export default function App() {
  return (
    <HashRouter>
      <header className="nav">
        <NavLink to="/" className="brand">JudgeBench-Code</NavLink>
        <nav>
          <NavLink to="/" end>Overview</NavLink>
          <NavLink to="/findings">Findings</NavLink>
          <NavLink to="/board">Leaderboard</NavLink>
          <NavLink to="/play">Fool the judge</NavLink>
          <NavLink to="/failures">Failures</NavLink>
          <NavLink to="/method">Method</NavLink>
          <a href="https://github.com/ellaslan11/judgebench">GitHub</a>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/findings" element={<Findings />} />
          <Route path="/board" element={<Leaderboard />} />
          <Route path="/play" element={<Playground />} />
          <Route path="/failures" element={<Failures />} />
          <Route path="/method" element={<Method />} />
        </Routes>
      </main>
      <footer className="foot muted small">
        JudgeBench-Code · code, data and every rating at <a href="https://github.com/ellaslan11/judgebench">github.com/ellaslan11/judgebench</a>.
        Benchmarks the grader, not the agent. No judge here is endorsed as safe.
      </footer>
    </HashRouter>
  );
}
