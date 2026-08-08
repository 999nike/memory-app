(() => {
  'use strict';

  const WORKSPACE_KEY = 'memory-space-v1';
  const ONBOARDING_KEY = 'memory-space-onboarding-v1';

  const now = () => new Date().toISOString();
  const uid = (prefix) => `${prefix}_${crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;

  function readWorkspace() {
    try {
      return JSON.parse(localStorage.getItem(WORKSPACE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function writeWorkspace(workspace) {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
  }

  function createBlankWorkspace() {
    const createdAt = now();
    const spaceId = uid('space');
    return {
      version: 1,
      activeSpaceId: spaceId,
      spaces: [{
        id: spaceId,
        name: 'My Memory Space',
        description: 'My private long-term context for AI.',
        createdAt,
        updatedAt: createdAt
      }],
      memories: []
    };
  }

  function ensureFirstRunState() {
    // Existing browser data is never migrated or replaced by onboarding.
    if (localStorage.getItem(WORKSPACE_KEY) !== null) return;

    const blank = createBlankWorkspace();
    writeWorkspace(blank);
    localStorage.setItem(ONBOARDING_KEY, 'pending');
  }

  function isOnboardingPending() {
    return localStorage.getItem(ONBOARDING_KEY) === 'pending';
  }

  function buildDialog() {
    const dialog = document.createElement('dialog');
    dialog.id = 'productOnboardingDialog';
    dialog.className = 'product-onboarding-dialog';
    dialog.innerHTML = `
      <form id="productOnboardingForm" class="product-onboarding-card">
        <div class="product-onboarding-mark" aria-hidden="true">M</div>
        <p class="product-onboarding-kicker">Memory Space</p>
        <h1>Your AI memory, owned by you.</h1>
        <p class="product-onboarding-copy">Create one private Space for the things you want AI to remember. You stay in control of what becomes trusted memory.</p>

        <div class="product-onboarding-points" aria-label="Memory Space principles">
          <span>Stored on this device</span>
          <span>You approve lasting changes</span>
          <span>Connect an AI when you are ready</span>
        </div>

        <label>
          Name your first Space
          <input id="productOnboardingName" maxlength="60" required autocomplete="off" value="My Memory Space" placeholder="My Memory Space">
        </label>

        <label>
          What is this Space for? <small>Optional</small>
          <textarea id="productOnboardingPurpose" rows="3" maxlength="300" placeholder="Personal memory, a project, research, work…"></textarea>
        </label>

        <button class="primary-button product-onboarding-submit" type="submit">Create my Memory Space</button>
        <p class="product-onboarding-footnote">No account setup or technical configuration is needed to create your Space.</p>
      </form>`;

    dialog.addEventListener('cancel', (event) => event.preventDefault());
    dialog.querySelector('#productOnboardingForm')?.addEventListener('submit', finishOnboarding);
    return dialog;
  }

  function finishOnboarding(event) {
    event.preventDefault();
    const dialog = event.currentTarget.closest('dialog');
    const name = dialog?.querySelector('#productOnboardingName')?.value.trim();
    const purpose = dialog?.querySelector('#productOnboardingPurpose')?.value.trim();
    if (!name) return;

    const workspace = readWorkspace();
    const space = workspace?.spaces?.find((item) => item.id === workspace.activeSpaceId) || workspace?.spaces?.[0];
    if (!workspace || !space) return;

    space.name = name;
    space.description = purpose || 'My private long-term context for AI.';
    space.updatedAt = now();
    workspace.activeSpaceId = space.id;
    writeWorkspace(workspace);
    localStorage.setItem(ONBOARDING_KEY, 'done');
    dialog?.close();

    // app.js keeps its own in-memory workspace state. Reload once so the normal
    // application starts from the newly named first Space without special cases.
    location.reload();
  }

  ensureFirstRunState();

  if (!isOnboardingPending()) return;

  const dialog = buildDialog();
  document.body.appendChild(dialog);
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector('#productOnboardingName')?.select());
})();
