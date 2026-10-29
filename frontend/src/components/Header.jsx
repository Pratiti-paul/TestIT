import { ShieldCheck } from 'lucide-react';

export function Header() {
  return (
    <header className="app-header">
      <div className="brand-container">
        <div className="brand-logo" aria-hidden="true">
          <ShieldCheck size={28} />
        </div>
        <div className="brand-text">
          <span className="brand-name">TestIT</span>
          <span className="brand-tagline">AI-Driven Website Quality & User-Flow Testing</span>
        </div>
      </div>
    </header>
  );
}

