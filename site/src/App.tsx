import { HashRouter, NavLink, Route, Routes } from "react-router-dom";
import Failures from "./pages/Failures";
import Leaderboard from "./pages/Leaderboard";
import Method from "./pages/Method";
import Playground from "./pages/Playground";

export default function App() {
  return (
    <HashRouter>
      <header className="nav">
        <span className="brand">JudgeBench-Code</span>
        <nav>
          <NavLink to="/" end>Leaderboard</NavLink>
          <NavLink to="/play">Fool the judge</NavLink>
          <NavLink to="/failures">Failures</NavLink>
          <NavLink to="/method">Method</NavLink>
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Leaderboard />} />
          <Route path="/play" element={<Playground />} />
          <Route path="/failures" element={<Failures />} />
          <Route path="/method" element={<Method />} />
        </Routes>
      </main>
    </HashRouter>
  );
}
