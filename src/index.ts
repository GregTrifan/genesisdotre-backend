import env from "dotenv";
import path from "path";
// Replace if using a different env file or config.
env.config({ path: "./.env" });
import cors from "cors";
import bodyParser from "body-parser";
import express from "express";
import { ethers } from "ethers";
import { GENESIS_ABI, GENESIS_ADDRESS } from "./contractInfo";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
	apiVersion: "2023-10-16",
	appInfo: {
		// For sample support and debugging, not required for production:
		name: "Genesis RE",
		url: "https://genesis.re/",
		version: "1.1.0",
	},
	typescript: true,
});

const app = express();
const resolve = path.resolve;

app.use(cors());

app.use(
	(
		req: express.Request,
		res: express.Response,
		next: express.NextFunction
	): void => {
		if (req.originalUrl === "/webhook") {
			next();
		} else {
			bodyParser.json()(req, res, next);
		}
	}
);

app.get("/", (_: express.Request, res: express.Response): void => {
	// Serve checkout page.
	const indexPath = resolve(process.env.STATIC_DIR + "/index.html");
	res.sendFile(indexPath);
});

app.get("/config", (_: express.Request, res: express.Response): void => {
	// Serve checkout page.
	res.send({
		publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
	});
});
async function convertEthToEur(ethPrice: number) {
	try {
		const response = await fetch(
			"https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=eur"
		);
		const data = await response.json();

		const eurPrice = ethPrice * data.ethereum.eur;
		return eurPrice;
	} catch (err) {
		console.error(err);
		return null;
	}
}
async function getCurrentPrice(): Promise<number> {
	try {
		const network = "homestead"; // MAINNET

		const provider = ethers.getDefaultProvider(network, {
			infura: process.env.INFURA_ID,
		});

		let GENESIS = new ethers.Contract(GENESIS_ADDRESS, GENESIS_ABI, provider);
		let currentPrice = ethers.utils.formatEther(await GENESIS.currentPrice());

		const currentPriceEur = await convertEthToEur(Number(currentPrice));
		if (currentPriceEur !== null) {
			console.log(
				"Current price: " + currentPrice + " ETH or " + currentPriceEur + " EUR"
			);
			return currentPriceEur;
		} else {
			console.log("Unable to fetch EUR price");
		}
	} catch (err) {
		console.log(err);
	}
}
app.get(
	"/create-payment-intent",
	async (req: express.Request, res: express.Response): Promise<void> => {
		const price: number = await getCurrentPrice();
		// Create a PaymentIntent with the order amount and currency.
		const params: Stripe.PaymentIntentCreateParams = {
			amount: Math.round(Number(price * 100)),
			currency: "EUR",
			automatic_payment_methods: {
				enabled: true,
			},
		};
		try {
			const paymentIntent: Stripe.PaymentIntent =
				await stripe.paymentIntents.create(params);

			// Send publishable key and PaymentIntent client_secret to client.
			res.send({
				clientSecret: paymentIntent.client_secret,
				amount: Math.round(Number(price)),
			});
		} catch (e) {
			res.status(400).send({
				error: {
					message: e.message,
				},
			});
		}
	}
);
app.get(
	"/create-test-intent",
	async (req: express.Request, res: express.Response): Promise<void> => {
		// Create a PaymentIntent with the order amount and currency.
		const params: Stripe.PaymentIntentCreateParams = {
			amount: 100,
			currency: "EUR",
			automatic_payment_methods: {
				enabled: true,
			},
		};
		try {
			const paymentIntent: Stripe.PaymentIntent =
				await stripe.paymentIntents.create(params);

			// Send publishable key and PaymentIntent client_secret to client.
			res.send({
				clientSecret: paymentIntent.client_secret,
				amount: 1,
			});
		} catch (e) {
			res.status(400).send({
				error: {
					message: e.message,
				},
			});
		}
	}
);

// Expose a endpoint as a webhook handler for asynchronous events.
// Configure your webhook in the stripe developer dashboard:
// https://dashboard.stripe.com/test/webhooks
app.post(
	"/webhook",
	// Use body-parser to retrieve the raw body as a buffer.
	bodyParser.raw({ type: "application/json" }),
	async (req: express.Request, res: express.Response): Promise<void> => {
		// Retrieve the event by verifying the signature using the raw body and secret.
		let event: Stripe.Event;

		try {
			event = stripe.webhooks.constructEvent(
				req.body,
				req.headers["stripe-signature"],
				process.env.STRIPE_WEBHOOK_SECRET
			);
		} catch (err) {
			console.log(`⚠️  Webhook signature verification failed.`);
			res.sendStatus(400);
			return;
		}

		// Extract the data from the event.
		const data: Stripe.Event.Data = event.data;
		const eventType: string = event.type;

		if (eventType === "payment_intent.succeeded") {
			// Cast the event into a PaymentIntent to make use of the types.
			const pi: Stripe.PaymentIntent = data.object as Stripe.PaymentIntent;
			// Funds have been captured
			// Fulfill any orders, e-mail receipts, etc
			// To cancel the payment after capture you will need to issue a Refund (https://stripe.com/docs/api/refunds).
			console.log(`🔔  Webhook received: ${pi.object} ${pi.status}!`);
			console.log("💰 Payment captured!");
		} else if (eventType === "payment_intent.payment_failed") {
			// Cast the event into a PaymentIntent to make use of the types.
			const pi: Stripe.PaymentIntent = data.object as Stripe.PaymentIntent;
			console.log(`🔔  Webhook received: ${pi.object} ${pi.status}!`);
			console.log("❌ Payment failed.");
		}
		res.sendStatus(200);
	}
);

app.listen(4242, (): void =>
	console.log(`Node server listening on port ${4242}!`)
);
