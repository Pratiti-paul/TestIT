import { useState, useRef, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { User, LogIn, UserPlus, X, HelpCircle } from 'lucide-react';

export function Header() {
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [authDialogState, setAuthDialogState] = useState({ isOpen: false, mode: 'login' });
  const profileMenuRef = useRef(null);
  const navigate = useNavigate();

  // Close dropdown when clicking outside or pressing Escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setProfileDropdownOpen(false);
        if (authDialogState.isOpen) {
          setAuthDialogState({ isOpen: false, mode: 'login' });
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [authDialogState.isOpen]);

  const handleOpenAuth = (mode) => {
    setProfileDropdownOpen(false);
    setAuthDialogState({ isOpen: true, mode });
  };

  const handleStartTesting = () => {
    setAuthDialogState({ isOpen: false, mode: 'login' });
    navigate('/');
    setTimeout(() => {
      const urlInput = document.getElementById('website-url');
      if (urlInput) urlInput.focus();
    }, 100);
  };

  return (
    <>
      <header className="app-header">
        {/* Left Side: TestIT Serif Wordmark + "How it works" */}
        <div className="header-left">
          <Link to="/" className="brand-wordmark-link" aria-label="TestIT Home">
            <span className="brand-wordmark">TestIT</span>
          </Link>

          <nav className="header-left-nav" aria-label="Primary Navigation">
            <NavLink
              to="/how-it-works"
              className={({ isActive }) => `header-nav-link ${isActive ? 'active' : ''}`}
            >
              How it works
            </NavLink>
          </nav>
        </div>

        {/* Right Side: Circular Profile Button */}
        <div className="header-right">
          <div className="profile-container" ref={profileMenuRef}>
            <button
              type="button"
              className={`profile-circular-btn ${profileDropdownOpen ? 'active' : ''}`}
              onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
              aria-label="Account profile options"
              aria-expanded={profileDropdownOpen}
              aria-haspopup="dialog"
            >
              <User size={18} aria-hidden="true" />
            </button>

            {profileDropdownOpen && (
              <div
                className="profile-dropdown-card"
                role="region"
                aria-label="Account Options"
              >
                <div className="dropdown-label-bar">
                  <span>Account</span>
                </div>
                <div className="dropdown-button-group">
                  <button
                    type="button"
                    className="dropdown-action-btn"
                    onClick={() => handleOpenAuth('login')}
                  >
                    <LogIn size={15} aria-hidden="true" />
                    <span>Login</span>
                  </button>
                  <button
                    type="button"
                    className="dropdown-action-btn"
                    onClick={() => handleOpenAuth('signup')}
                  >
                    <UserPlus size={15} aria-hidden="true" />
                    <span>Sign Up</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Auth Preview Notice Modal (Honoring "Do not create fake authentication") */}
      {authDialogState.isOpen && (
        <div
          className="auth-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="auth-dialog-title"
        >
          <div className="auth-dialog-container">
            <button
              type="button"
              className="auth-dialog-close-btn"
              onClick={() => setAuthDialogState({ isOpen: false, mode: 'login' })}
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>

            <div className="auth-dialog-head">
              <div className="auth-dialog-icon-circle">
                {authDialogState.mode === 'login' ? <LogIn size={22} /> : <UserPlus size={22} />}
              </div>
              <h2 id="auth-dialog-title" className="auth-dialog-heading">
                {authDialogState.mode === 'login' ? 'User Login' : 'Create an Account'}
              </h2>
            </div>

            <div className="auth-dialog-content">
              <div className="auth-preview-badge">
                <span>Private Preview</span>
              </div>
              <p className="auth-dialog-text">
                Cloud user accounts and team workspace dashboards are currently available in private preview for enterprise early access.
              </p>
              <div className="auth-dialog-card-callout">
                <HelpCircle size={18} className="callout-icon" aria-hidden="true" />
                <p>
                  <strong>No Account Required:</strong> Autonomous AI-driven website testing is currently open and fully functional directly on this landing page. You do not need to sign in to run your tests.
                </p>
              </div>
            </div>

            <div className="auth-dialog-actions">
              <button
                type="button"
                className="auth-dialog-start-btn"
                onClick={handleStartTesting}
              >
                Start Testing Now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
