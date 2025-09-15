import { test, expect } from "@playwright/test";
import dotenv from "dotenv";
dotenv.config();

test("Extract lead details and fields from Fundly", async ({
	page,
}, testInfo) => {
	//////////////////
	// FUNDLY LOGIN
	//////////////////

	// Navigate to the login page
	await page.goto("https://app.getfundly.com/login?redirectTo=/c/business");

	const FUNDLY_EMAIL = process.env.FUNDLY_EMAIL || "jeff@glenross.ai";
	const FUNDLY_PASSWORD = process.env.FUNDLY_PASSWORD || "jotcyv-ryzvy8-Quzjih";

	// Email input
	await page.getByRole("textbox", { name: "Email" }).click();
	await page.getByRole("textbox", { name: "Email" }).fill(FUNDLY_EMAIL);
	await page.getByRole("textbox", { name: "Email" }).press("Enter");
	// Password input
	await page.getByRole("textbox", { name: "Password" }).click();
	await page.getByRole("textbox", { name: "Password" }).fill(FUNDLY_PASSWORD);
	await page.getByRole("button", { name: "Login" }).click();

	// Determine login result by URL change or failure banner
	let loggedIn = false;
	try {
		await page.waitForURL(/\/c\/business(\b|\/|\?|$)/, { timeout: 15000 });
		loggedIn = true;
	} catch (e) {
		// No-op; check failure banner next
	}
	if (!loggedIn) {
		// Give the app a brief moment to render any notification
		await page.waitForTimeout(1000);
		const loginErrorVisible = await page
			.getByText(/Invalid login credentials/i)
			.isVisible();
		if (loginErrorVisible) {
			// Attach snapshot for debugging
			await testInfo.attachments.push({
				name: "login-failure-snapshot.html",
				contentType: "text/html",
				body: Buffer.from(await page.content()),
			});
			throw new Error(
				"Login failed: Invalid login credentials. Set FUNDLY_EMAIL/FUNDLY_PASSWORD env vars and retry.",
			);
		}

		// If neither success nor explicit failure detected, capture context and fail clearly
		await testInfo.attachments.push({
			name: "login-uncertain-snapshot.html",
			contentType: "text/html",
			body: Buffer.from(await page.content()),
		});
		throw new Error(
			`Login state uncertain. Current URL: ${await page.url()}. Please verify credentials/UI.`,
		);
	}

	////////////////////////////////////
	// ADD LATEST LEAD AND GO TO PIPELINE
	////////////////////////////////////

	// Wait for the dashboard to load (e.g., wait for "Realtime Lead Timeline" text)
	await page.waitForSelector('text="Realtime Lead Timeline"', {
		state: "visible",
		timeout: 10000,
	});

	// NEW: Scroll feed and click visible "Add to My Pipeline" buttons (reuse idea from api_bot)
	// We only augment with scrolling; no other behavioral changes
	await page.evaluate(async () => {
		let totalClicked = 0;
		let scrollCount = 0;
		const maxScrolls = 4;

		async function waitForButtonChange(button: HTMLButtonElement) {
			return new Promise<void>((resolve) => {
				const observer = new MutationObserver(() => {
					if (button.textContent?.trim() === "View in My Pipeline") {
						observer.disconnect();
						resolve();
					}
				});
				observer.observe(button, { childList: true, characterData: true, subtree: true });
				setTimeout(() => { observer.disconnect(); resolve(); }, 8000);
			});
		}

		async function processCurrentButtons() {
			const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
			const addButtons = buttons.filter((b) => b.textContent?.trim() === 'Add to My Pipeline');
			for (const btn of addButtons) {
				btn.click();
				totalClicked++;
				await waitForButtonChange(btn);
				await new Promise((r) => setTimeout(r, 500));
			}
		}

		await processCurrentButtons();
		while (scrollCount < maxScrolls) {
			scrollCount++;
			window.scrollTo(0, document.body.scrollHeight);
			await new Promise((r) => setTimeout(r, 1200));
			await processCurrentButtons();
		}
		console.debug('Scrolled + clicked Add buttons:', totalClicked);
	});

	// Try to find and click the latest "Add to My Pipeline" button (defensive selectors)
	let leadId: string | null = null;
	const addButtons = await page.$$('button[label="Add to My Pipeline"]');
	if (addButtons.length > 0) {
		// Take the first button (latest lead appears first)
		const addBtn = addButtons[0];
		const containerHandle = await addBtn.evaluateHandle(
			(btn) => (btn as HTMLElement).closest("div[id]") as HTMLElement | null,
		);
		leadId = await containerHandle.evaluate(
			(el: HTMLElement | null) => el?.id || null,
		);
		console.log("Found Add button. Lead ID:", leadId);
		try {
			await addBtn.waitForElementState("stable");
			await addBtn.click();
			await page.waitForTimeout(2000); // allow propagation
		} catch (e) {
			console.warn("Failed to click Add button; proceeding to pipeline.");
		}
	} else {
		console.log(
			'No "Add to My Pipeline" button found. Proceeding to pipeline.',
		);
	}

	// Click the "Add to My Pipeline" button if found, with propagation delay
	if (leadId) {
		const addButton = await page
			.locator(`div[id="${leadId}"] button[label="Add to My Pipeline"]`)
			.first();
		if ((await addButton.count()) > 0) {
			await addButton.waitFor({ state: "visible", timeout: 10000 });
			await addButton.click();
			// Wait for server propagation (e.g., 2 seconds)
			await new Promise((resolve) => setTimeout(resolve, 2000));
		} else {
			console.log(
				"No Add to My Pipeline button for captured lead, assuming already added.",
			);
		}
	}

	// Navigate to My Pipeline
	await page.getByRole("link", { name: "My Pipeline" }).click();
	// Wait for the pipeline page to load; be resilient to class name changes
	let pipelineLeadIds: string[] = [];
	try {
		await page.waitForSelector("div.chakra-stack.css-8g8ihq div[id]", {
			state: "visible",
			timeout: 15000,
		});
		pipelineLeadIds = await page.$$eval(
			"div.chakra-stack.css-8g8ihq div[id]",
			(els) => els.map((el) => (el as HTMLElement).id),
		);
	} catch {
		// Fallback: any div with id inside left pane-like container
		try {
			await page.waitForSelector("div[id]", {
				state: "visible",
				timeout: 10000,
			});
			pipelineLeadIds = await page.$$eval("div[id]", (els) =>
				els.map((el) => (el as HTMLElement).id).filter(Boolean),
			);
		} catch {
			pipelineLeadIds = [];
		}
	}
	console.log("Visible lead IDs on pipeline page:", pipelineLeadIds);
	await testInfo.attachments.push({
		name: "pipeline-snapshot.html",
		contentType: "text/html",
		body: Buffer.from(await page.content()),
	});

	////////////////////////////////////
	// PULL DATA FROM LEAD AND SEND EXCLUSIVE CODE
	////////////////////////////////////

	// Click on the lead using the captured or detected ID in the left pane
	if (!leadId && pipelineLeadIds.length > 0) {
		leadId = pipelineLeadIds[0];
	}
	if (leadId) {
		const leadLocator = page.locator(
			`div.chakra-stack.css-8g8ihq div[id="${leadId}"]`,
		);
		// If the specific container is not found under the expected wrapper, fallback to global id lookup
		try {
			await leadLocator.waitFor({ state: "visible", timeout: 8000 });
			await leadLocator.click();
		} catch {
			const anyLeadLocator = page.locator(`div[id="${leadId}"]`).first();
			await anyLeadLocator.waitFor({ state: "visible", timeout: 8000 });
			await anyLeadLocator.click();
		}
	} else {
		// Fallback to first visible lead if no ID available
		const firstLead = page
			.locator("div.chakra-stack.css-8g8ihq div[id]")
			.first();
		try {
			await firstLead.waitFor({ state: "visible", timeout: 8000 });
			await firstLead.click();
		} catch {
			const anyFirstLead = page.locator("div[id]").first();
			await anyFirstLead.waitFor({ state: "visible", timeout: 8000 });
			await anyFirstLead.click();
		}
	}

	// Try to reveal contact info if button exists, otherwise proceed
	try {
		await page.getByRole("button", { name: "Reveal" }).click({ timeout: 5000 });
		console.log("Contact info revealed");
	} catch {
		console.log("No Reveal button found or already revealed");
	}

	// Get their email and phone from the contact section
	const contactSection = page.locator('[role="tabpanel"][aria-labelledby*="tab-0"]');
	const email = await contactSection.locator('p:text-is("Email") + p').textContent() || "Unknown Email";
	const phone = await contactSection.locator('p:text-is("Phone") + p').textContent() || "Unknown Phone";
	console.log("Extracted Email:", email.trim());
	console.log("Extracted Phone:", phone.trim());

	// Reveal all background info - required to get the looking_for amounts
	await page.getByText("Show more").click();
	console.log("Background info expanded");

	// Extract background info and field values directly from the page
	const backgroundInfoRaw =
		(await page.locator('p:text-is("Background Info") + p').textContent()) ||
		"";
	const backgroundInfo = backgroundInfoRaw.replace(/Show less$/i, "").trim();

	// Helper function to extract field values directly from page
	const getFieldValue = async (fieldName: string) => {
		try {
			const locator = page.locator(`p:text-is("${fieldName}") + p`);
			return (await locator.textContent())?.trim() || "";
		} catch {
			return "";
		}
	};

	const leadData = {
		id: leadId || "Unknown ID",
		email: email.trim(),
		phone: phone.trim(),
		background_info: backgroundInfo,
		email_sent_at: null,
		created_at: "",
		can_contact: true,
		use_of_funds: await getFieldValue("Use of Funds"),
		location: await getFieldValue("Location"),
		urgency: await getFieldValue("Urgency"),
		time_in_business: await getFieldValue("Time in Business"),
		bank_account: await getFieldValue("Bank Account"),
		annual_revenue: await getFieldValue("Annual Revenue"),
		industry: await getFieldValue("Industry"),
		looking_for_min: "",
		looking_for_max: "",
	};

	// Parse looking_for range from background_info if present
	const backgroundText = leadData.background_info;
	if (
		backgroundText &&
		backgroundText.includes("How much they are looking for:")
	) {
		const rangeMatch = backgroundText.match(
			/How much they are looking for:\s*\$([0-9,]+)\s*-\s*\$([0-9,]+)/,
		);
		if (rangeMatch) {
			leadData.looking_for_min = `$${rangeMatch[1]}`;
			leadData.looking_for_max = `$${rangeMatch[2]}`;
		}
	}

	// Set created_at (use current time)
	leadData.created_at = new Date().toISOString().replace("Z", "+00:00"); // e.g., "2025-09-14T18:52:00+00:00" (02:52 PM EDT)

	// Output the extracted data to console
	console.log("Extracted Lead Data:", leadData);

	// Save JSON data to test results folder using Playwright's default attachment method
	await testInfo.attachments.push({
		name: "lead-data.json",
		contentType: "application/json",
		body: Buffer.from(JSON.stringify(leadData, null, 2)),
	});

	// Also save JSON file directly to project directory for easy access
	const fs = require('fs');
	const path = require('path');
	const outputPath = path.join(process.cwd(), 'extracted-lead-data.json');
	fs.writeFileSync(outputPath, JSON.stringify(leadData, null, 2));
	console.log(`JSON data saved to: ${outputPath}`);

	// Assertions
	expect(leadData.email).not.toBe("Unknown Email");
	expect(leadData.phone).not.toBe("Unknown Phone");
	expect(Object.keys(leadData).length).toBeGreaterThan(2);
});
