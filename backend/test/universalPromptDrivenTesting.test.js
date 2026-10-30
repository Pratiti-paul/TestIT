import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { executeAiAgent } from '../src/services/aiAgentService.js';
import { MockProvider } from '../src/services/aiProvider/mockProvider.js';

describe('Phase 4.6: Universal Prompt-Driven Website Testing Suite', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);

      // -------------------------------------------------------------
      // FIXTURE 1: Clinic / Healthcare Appointment Scheduling Portal
      // Materially different from e-commerce: Selects, slots, patient forms, confirmation reference
      // -------------------------------------------------------------
      if (url.pathname === '/clinic-portal') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Apex Medical Clinic - Scheduling</title></head>
            <body>
              <header>
                <h1>Apex Healthcare Portal</h1>
                <nav><a href="/clinic-portal">Appointments</a> <a href="/clinic-portal/info">Doctor Info</a></nav>
              </header>
              <main>
                <h2>Schedule a Consultation</h2>
                <form id="booking-form" onsubmit="event.preventDefault(); bookAppointment();">
                  <label for="specialty-select">Specialty</label>
                  <select id="specialty-select" name="specialty">
                    <option value="">-- Choose Specialty --</option>
                    <option value="cardiology">Cardiology</option>
                    <option value="pediatrics">Pediatrics</option>
                    <option value="dermatology">Dermatology</option>
                  </select>

                  <fieldset id="time-slots">
                    <legend>Select Available Slot</legend>
                    <button type="button" class="slot-btn" onclick="selectSlot('Tomorrow at 10:00 AM')">Tomorrow at 10:00 AM</button>
                    <button type="button" class="slot-btn" onclick="selectSlot('Tomorrow at 2:30 PM')">Tomorrow at 2:30 PM</button>
                  </fieldset>
                  <input type="hidden" id="chosen-slot" name="slot" value="" />

                  <label for="patient-name">Patient Full Name</label>
                  <input type="text" id="patient-name" name="patientName" placeholder="Enter patient name" />

                  <label for="patient-phone">Contact Phone</label>
                  <input type="tel" id="patient-phone" name="patientPhone" placeholder="555-0199" />

                  <button type="submit" id="submit-booking-btn">Confirm Appointment</button>
                </form>

                <div id="booking-result" style="display:none;" role="status">
                  <h3>Appointment Confirmed!</h3>
                  <p id="confirmation-code">Booking Reference: #APPT-7492</p>
                  <p id="patient-summary"></p>
                </div>
              </main>

              <script>
                function selectSlot(slotText) {
                  document.getElementById('chosen-slot').value = slotText;
                  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('active'));
                  event.target.classList.add('active');
                }

                function bookAppointment() {
                  const spec = document.getElementById('specialty-select').value;
                  const name = document.getElementById('patient-name').value;
                  const phone = document.getElementById('patient-phone').value;
                  if (!spec || !name) return;

                  document.getElementById('booking-form').style.display = 'none';
                  const res = document.getElementById('booking-result');
                  res.style.display = 'block';
                  document.getElementById('patient-summary').innerText = name + ' (' + spec + ') - ' + phone;
                }
              </script>
            </body>
          </html>
        `);
      }

      // -------------------------------------------------------------
      // FIXTURE 2: Remote Job Directory & Application Portal
      // Materially different from e-commerce/clinic: Tabs, filter pills, job listings, application drawer
      // -------------------------------------------------------------
      else if (url.pathname === '/job-board') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>RemoteTech Jobs - Engineering Board</title></head>
            <body>
              <header>
                <h1>RemoteTech Careers</h1>
              </header>
              <main>
                <div class="search-toolbar">
                  <input type="search" id="job-search" placeholder="Search positions..." aria-label="Search job positions" />
                  <button type="button" id="search-btn">Search</button>
                  <div role="tablist">
                    <button role="tab" id="remote-pill" onclick="toggleRemoteFilter()">Remote Only</button>
                  </div>
                </div>

                <section id="job-listings">
                  <article class="job-card" id="job-1" data-remote="true">
                    <h3>Staff Reliability Engineer</h3>
                    <p class="location">Remote - Global</p>
                    <button type="button" class="view-btn" onclick="openJobDetails('Staff Reliability Engineer')">View Position</button>
                  </article>
                  <article class="job-card" id="job-2" data-remote="false">
                    <h3>Office Systems Admin</h3>
                    <p class="location">New York - On-site</p>
                    <button type="button" class="view-btn" onclick="openJobDetails('Office Systems Admin')">View Position</button>
                  </article>
                </section>

                <div id="job-details-modal" style="display:none;" role="region" aria-label="Job Details">
                  <h2 id="modal-job-title"></h2>
                  <p id="modal-job-desc">Design and maintain high-scale distributed agent infrastructure.</p>
                  <button type="button" id="apply-btn" onclick="submitApplication()">Apply Now</button>
                </div>

                <div id="application-status" style="display:none;" role="alert">
                  Application Submitted Successfully for Staff Reliability Engineer!
                </div>
              </main>

              <script>
                function toggleRemoteFilter() {
                  const pill = document.getElementById('remote-pill');
                  pill.classList.toggle('active');
                  const onlyRemote = pill.classList.contains('active');
                  document.querySelectorAll('.job-card').forEach(c => {
                    if (onlyRemote && c.getAttribute('data-remote') !== 'true') {
                      c.style.display = 'none';
                    } else {
                      c.style.display = 'block';
                    }
                  });
                }

                function openJobDetails(title) {
                  document.getElementById('modal-job-title').innerText = title;
                  document.getElementById('job-details-modal').style.display = 'block';
                }

                function submitApplication() {
                  document.getElementById('job-details-modal').style.display = 'none';
                  document.getElementById('application-status').style.display = 'block';
                }
              </script>
            </body>
          </html>
        `);
      }

      // -------------------------------------------------------------
      // FIXTURE 3: Locator Discovery & Recovery Demonstration
      // Tests cross-role recovery (link as button, emoji prefix in name) and genuine not-found handling
      // -------------------------------------------------------------
      else if (url.pathname === '/locator-recovery') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Locator Recovery Fixture</title></head>
            <body>
              <header>
                <a href="/checkout-target" class="checkout-link" aria-label="Proceed to Checkout">
                  <span>🛒 2 Items</span>
                </a>
              </header>
              <main>
                <div id="target-confirmed" style="display:none;">Action Successful</div>
              </main>
              <script>
                document.querySelector('.checkout-link').addEventListener('click', (e) => {
                  e.preventDefault();
                  document.getElementById('target-confirmed').style.display = 'block';
                });
              </script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  // -------------------------------------------------------------------------
  // 1. Workflow 1: Clinic / Healthcare Appointment Scheduling Portal
  // -------------------------------------------------------------------------
  it('Workflow 1: executes clinic appointment scheduling driven entirely by user instruction without pre-baked flows', async () => {
    const plannedObjectives = [
      {
        id: 'obj-appt-1',
        description: 'Select specialty and appointment slot',
        targetBehavior: 'Select specialty and slot',
        expectedOutcome: 'Specialty and appointment slot chosen',
        requiresAuth: false,
      },
      {
        id: 'obj-appt-2',
        description: 'Fill patient contact info and submit appointment booking',
        targetBehavior: 'Submit booking',
        expectedOutcome: 'Booking reference appears in confirmation status',
        requiresAuth: false,
        dependsOn: ['obj-appt-1'],
      },
    ];

    const clinicSteps = [
      {
        thought: 'Select Cardiology specialty from the dropdown',
        action: 'select',
        target: { strategy: 'label', value: 'Specialty' },
        value: 'cardiology',
        expectedOutcome: 'Cardiology specialty selected',
      },
      {
        thought: 'Choose the Tomorrow at 10:00 AM slot',
        action: 'click',
        target: { strategy: 'text', value: 'Tomorrow at 10:00 AM' },
        expectedOutcome: 'Appointment slot selected',
      },
      {
        thought: 'Conclude first objective: specialty and slot selected',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Cardiology specialty and 10:00 AM slot selected.' },
      },
      {
        thought: 'Enter patient full name',
        action: 'fill',
        target: { strategy: 'placeholder', value: 'Enter patient name' },
        value: 'Jordan Smith',
        expectedOutcome: 'Patient name entered',
      },
      {
        thought: 'Enter contact phone number',
        action: 'fill',
        target: { strategy: 'placeholder', value: '555-0199' },
        value: '555-0199',
        expectedOutcome: 'Phone number entered',
      },
      {
        thought: 'Submit appointment booking',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Confirm Appointment' },
        expectedOutcome: 'Appointment submitted',
      },
      {
        thought: 'Verify appointment confirmation reference #APPT-7492 is displayed',
        action: 'assertVisible',
        target: { strategy: 'text', value: 'Booking Reference: #APPT-7492' },
        expectedOutcome: 'Booking reference visible in DOM',
      },
      {
        thought: 'Conclude booking verification: confirmation reference #APPT-7492 verified',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Appointment confirmed with reference #APPT-7492 for Jordan Smith.' },
      },
    ];

    const mockProvider = new MockProvider(clinicSteps, plannedObjectives);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/clinic-portal`,
        instructions:
          "Select 'Cardiology' specialty, pick the 'Tomorrow at 10:00 AM' slot, enter patient name 'Jordan Smith' with phone '555-0199', submit the appointment, and verify that the booking confirmation with reference '#APPT-7492' appears.",
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 15,
      }
    );

    assert.equal(report.status, 'passed', `Clinic test should pass, got: ${report.status}`);
    assert.equal(report.failedSteps, 0);

    // Verify key steps executed and confirmed
    const assertStep = report.steps.find((s) => s.action === 'assertVisible');
    assert.ok(assertStep, 'assertVisible step must exist proving confirmation reference');
    assert.equal(assertStep.status, 'PASS');
    assert.ok(assertStep.actual.includes('#APPT-7492'));

    // Confirm contiguous step indexing
    report.steps.forEach((s, idx) => assert.equal(s.stepIndex, idx + 1));
  });

  // -------------------------------------------------------------------------
  // 2. Workflow 2: Remote Job Directory & Application Portal
  // -------------------------------------------------------------------------
  it('Workflow 2: executes job search, filter toggle, modal view and application submission without domain bias', async () => {
    const plannedObjectives = [
      {
        id: 'obj-job-1',
        description: 'Filter for remote positions and view position details',
        targetBehavior: 'Filter remote and view details',
        expectedOutcome: 'Job description modal appears',
        requiresAuth: false,
      },
      {
        id: 'obj-job-2',
        description: 'Submit application and verify submission confirmation',
        targetBehavior: 'Apply for job',
        expectedOutcome: 'Application submitted alert visible',
        requiresAuth: false,
        dependsOn: ['obj-job-1'],
      },
    ];

    const jobSearchSteps = [
      {
        thought: 'Click the Remote Only filter pill',
        action: 'click',
        target: { strategy: 'role', value: 'tab', name: 'Remote Only' },
        expectedOutcome: 'Filter toggled to Remote Only',
      },
      {
        thought: 'Click View Position on the first job listing',
        action: 'click',
        target: { strategy: 'text', value: 'View Position' },
        expectedOutcome: 'Job modal opened',
      },
      {
        thought: 'Verify job description modal is visible',
        action: 'assertVisible',
        target: { strategy: 'text', value: 'Design and maintain high-scale distributed agent infrastructure.' },
        expectedOutcome: 'Modal content visible',
      },
      {
        thought: 'Conclude objective 1: job details modal visible',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Remote job details modal opened and verified.' },
      },
      {
        thought: 'Click Apply Now button inside modal',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Apply Now' },
        expectedOutcome: 'Application submitted',
      },
      {
        thought: 'Verify application submitted confirmation alert',
        action: 'assertVisible',
        target: { strategy: 'text', value: 'Application Submitted Successfully for Staff Reliability Engineer!' },
        expectedOutcome: 'Submission confirmation alert visible',
      },
      {
        thought: 'Conclude application workflow: submission alert verified',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Job application successfully submitted and confirmed.' },
      },
    ];

    const mockProvider = new MockProvider(jobSearchSteps, plannedObjectives);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/job-board`,
        instructions:
          "Filter by 'Remote Only', view the position details, click 'Apply Now', and verify the application submission confirmation alert appears.",
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 15,
      }
    );

    assert.equal(report.status, 'passed', `Job board test should pass, got: ${report.status}`);
    assert.equal(report.failedSteps, 0);

    const confirmationStep = report.steps.find((s) => s.action === 'assertVisible' && s.actual.includes('Application Submitted Successfully'));
    assert.ok(confirmationStep, 'Confirmation alert must be verified in execution steps');
    assert.equal(confirmationStep.status, 'PASS');

    report.steps.forEach((s, idx) => assert.equal(s.stepIndex, idx + 1));
  });

  // -------------------------------------------------------------------------
  // 3. Generic Locator Discovery & Recovery Tests
  // -------------------------------------------------------------------------
  it('recovers dynamically when model specifies role="button" but element is an <a> with aria-label and emoji text', async () => {
    const plannedObjectives = [
      {
        id: 'obj-rec-1',
        description: 'Click checkout control and verify action',
        targetBehavior: 'Recover and click checkout control',
        expectedOutcome: 'Target confirmed element visible',
        requiresAuth: false,
      },
    ];

    const recoverySteps = [
      // Model emits role: "button" with name: "Proceed to Checkout"
      // In the DOM, the element is <a class="checkout-link" aria-label="Proceed to Checkout"><span>🛒 2 Items</span></a>
      {
        thought: 'Click the Proceed to Checkout control to proceed',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Proceed to Checkout' },
        expectedOutcome: 'Checkout control activated',
      },
      {
        thought: 'Verify action successful message is displayed',
        action: 'assertVisible',
        target: { strategy: 'text', value: 'Action Successful' },
        expectedOutcome: 'Action Successful visible',
      },
      {
        thought: 'Conclude objective: checkout link recovered and clicked successfully',
        action: 'conclude',
        conclude: { outcome: 'PASS', reasoning: 'Target action verified via locator recovery.' },
      },
    ];

    const mockProvider = new MockProvider(recoverySteps, plannedObjectives);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/locator-recovery`,
        instructions: 'Click the checkout link and verify confirmation.',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 10,
      }
    );

    assert.equal(report.status, 'passed', `Locator recovery test should pass, got: ${report.status}`);
    const assertStep = report.steps.find((s) => s.action === 'assertVisible');
    assert.ok(assertStep && assertStep.status === 'PASS');
  });

  it('fails cleanly with clear diagnostic when an element genuinely does not exist on page', async () => {
    const plannedObjectives = [
      {
        id: 'obj-fail-1',
        description: 'Attempt to interact with non-existent element',
        targetBehavior: 'Target non-existent element',
        expectedOutcome: 'Element located',
        requiresAuth: false,
      },
    ];

    const failSteps = [
      {
        thought: 'Click a completely fictitious non-existent control',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Completely NonExistent Magic Button' },
        expectedOutcome: 'Button clicked',
      },
    ];

    const mockProvider = new MockProvider(failSteps, plannedObjectives);

    const report = await executeAiAgent(
      {
        url: `${baseUrl}/clinic-portal`,
        instructions: 'Click the non-existent button.',
      },
      {
        provider: mockProvider,
        allowLocalForTesting: true,
        maxSteps: 5,
        stepTimeoutMs: 3000,
      }
    );

    assert.equal(report.status, 'failed');
    const failedStep = report.steps.find((s) => s.status === 'FAIL');
    assert.ok(failedStep, 'Step must fail cleanly');
    assert.ok(failedStep.actual.includes('could not be located on the page after inspecting live roles'));
  });
});
