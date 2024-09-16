import { Elysia } from 'elysia';

const moratUrl = 'http://localhost:3000';
const maxAgents = 50;
const agentMinActionSeconds = 0.5;
const agentMaxActionSeconds = 5;
const agentMinFriends = 1;
const optOutOdds = 0.1;

const pointAmounts = [10, 100, 250];
const pointStyleOdds = [0.5, 0.3, 0.1];
const pointAmountsProb = [
	[0.75, 0.25, 0.05], // Skews cheap
	[0.17, 0.66, 0.17], // Kinda normal distribution
	[0.15, 0.35, 0.5], // Skews generous
];

type Agent = {
	key: string;
	friends: string[];
	actionMs: number;
	pointsStyle: number;
	pointsProb: number[];
};

const agentKeys = new Set<string>();
const optsOutKeys = new Set<string>();

const createAgent = (key: string) => {
	const allKeys = Array.from(agentKeys);

	const agentMaxFriends = Math.floor(allKeys.length * 0.8);

	const friends: string[] = [];
	const friendCount = Math.floor(
		Math.random() * (agentMaxFriends - agentMinFriends + 1) + agentMinFriends
	);
	for (let i = 0; i < friendCount; i++) {
		let friend = '';
		do {
			const friendIdx = Math.floor(Math.random() * allKeys.length);
			friend = allKeys[friendIdx];
		} while (friends.includes(friend) || friend === key);
		friends.push(friend);
	}
	const actionMs = Math.round(
		1000 *
			(Math.random() * (agentMaxActionSeconds - agentMinActionSeconds) +
				agentMinActionSeconds)
	);
	const styleChoice = Math.random();
	let pointsStyle = 0;
	for (let i = 0, oddsAcc = 0; i < pointStyleOdds.length; i++) {
		oddsAcc += pointStyleOdds[i];
		if (styleChoice < oddsAcc) {
			pointsStyle = i;
			break;
		}
	}
	const agent: Agent = {
		key,
		friends,
		actionMs,
		pointsStyle,
		pointsProb: pointAmountsProb[pointsStyle],
	};
	return agent;
};

const agentOperate = async (agent: Agent): Promise<void> => {
	const minPointsToTransfer = 10;
	/* eslint no-constant-condition: 0 */
	while (true) {
		await Bun.sleep(agent.actionMs);

		const friendIdx = Math.floor(Math.random() * agent.friends.length);
		const friend = agent.friends[friendIdx];

		if (optsOutKeys.has(agent.key)) {
			// Agents who have opted out will claim their points once per tick
			const claimReq = await fetch(`${moratUrl}/points/claim/${agent.key}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ index: 0 }),
			});
			if (!claimReq.ok) {
				const claimBody = await claimReq.text();
				console.error(`Failed to claim points for ${agent.key}`);
				console.error(` . ${claimReq.status} ${claimBody}`);
			}
		}

		const tallyResp = await fetch(`${moratUrl}/points/${agent.key}/tally`, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' },
		});
		const tallyBody = await tallyResp.json();
		console.log(
			`Agent ${agent.key} has ${tallyBody.own}/${tallyBody.assigned}/${tallyBody.total} points`
		);
		const availablePoints = tallyBody.total;
		// Do not clamp this to maxPctToTransfer, because chances are Math.random() will
		// return a value higher than that, so it will often transfer tha max. Multiplying
		// by the max is better.
		const chosenOdds = Math.random();
		let chosenAmount = 0;
		for (
			let i = 0, oddsAcc = 0, lastAmount = 0;
			i < pointAmounts.length && pointAmounts[i] <= availablePoints;
			i++
		) {
			oddsAcc += agent.pointsProb[i];
			if (chosenOdds < oddsAcc) {
				chosenAmount = pointAmounts[i];
				break;
			} else {
				chosenAmount = lastAmount;
				lastAmount = pointAmounts[i];
			}
		}
		const pointsToTransfer = Math.max(minPointsToTransfer, chosenAmount);
		if (availablePoints <= 0) {
			console.warn(
				` . Agent ${agent.key} has no points to transfer - skipping`
			);
			continue;
		} else if (availablePoints < pointsToTransfer) {
			console.warn(
				` . Agent ${agent.key} only has ${availablePoints} points, not enough to transfer`
			);
			continue;
		}

		console.log(
			` . Agent ${agent.key} will assign ${pointsToTransfer} points to ${friend} (mode: ${agent.pointsStyle})`
		);
		const assignResp = await fetch(
			`${moratUrl}/points/transfer/${agent.key}/${friend}/${pointsToTransfer}`,
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
			}
		);
		if (!assignResp.ok) {
			console.error(`Failed to transfer points from ${agent.key} to ${friend}`);
			console.error(` . ${assignResp.status} ${assignResp.statusText}`);
		}
	}
};

console.log('Registering agents...');
for (let i = 0; i < maxAgents; i++) {
	let key = '';
	do {
		key = Math.random().toString(36).substring(7);
	} while (agentKeys.has(key));
	agentKeys.add(key);

	const optsIn = Math.random() > optOutOdds;
	if (!optsIn) {
		optsOutKeys.add(key);
	}

	const response = await fetch(`${moratUrl}/user/${key}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ optsIn }),
	});

	if (response.status !== 200) {
		console.error(`Failed to create user ${key}`);
	} else {
		const body = await response.json();
		// console.log(body);
		console.log(
			` . Created user ${key} epoch ${body.epochSignUp}. Opted in: ${optsIn}`
		);
	}
}

console.log('Getting all existing users...');
const respAgents = await fetch(`${moratUrl}/user`, {
	method: 'GET',
	headers: { 'Content-Type': 'application/json' },
});
const userList = await respAgents.json();
agentKeys.clear();
for (const key of userList) {
	if (key != 'morat') {
		agentKeys.add(key);
		const agentResp = await fetch(`${moratUrl}/user/${key}`, {
			method: 'GET',
		});
		const agent = await agentResp.json();
		if (!agent.optsIn) {
			console.log(` . Agent ${key} has opted out`);
			optsOutKeys.add(key);
		}
	}
}

const allAgents = Array.from(agentKeys).map(createAgent);

console.log('Roll call...');
for (const agent of allAgents) {
	console.log(
		` . Agent ${agent.key} has ${agent.friends.length} friends, mode: ${agent.pointsStyle}`
	);
}

const app = new Elysia()
	.get('/agent', () => allAgents)
	.get('/', () => 'Hello Agent Swarm')
	.listen(3030);

console.log(
	`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

const allOperations = allAgents.map(agentOperate);
await Promise.all(allOperations);
