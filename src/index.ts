import { Elysia } from 'elysia';

const moratUrl = 'http://localhost:3000';
const maxAgents = 10;
const agentMinActionSeconds = 0.5;
const agentMaxActionSeconds = 5;
const agentMinFriends = 1;

type Agent = {
	key: string;
	friends: string[];
	actionMs: number;
};

const agentKeys = new Set<string>();

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
	const agent: Agent = {
		key,
		friends,
		actionMs,
	};
	return agent;
};

const agentOperate = async (agent: Agent): Promise<void> => {
	const minPointsToTransfer = 10;
	const maxPctToTransfer = 0.1;
	/* eslint no-constant-condition: 0 */
	while (true) {
		await Bun.sleep(agent.actionMs);

		const friendIdx = Math.floor(Math.random() * agent.friends.length);
		const friend = agent.friends[friendIdx];

		const response = await fetch(`${moratUrl}/points/${agent.key}/tally`, {
			method: 'GET',
			headers: { 'Content-Type': 'application/json' },
		});
		const body = await response.json();
		console.log(
			`Agent ${agent.key} has ${body.own}/${body.assigned}/${body.total} points`
		);
		const availablePoints = body.total;
		// Do not clamp this to maxPctToTransfer, because chances are Math.random() will
		// return a value higher than that, so it will often transfer tha max. Multiplying
		// by the max is better.
		const pctToTransfer = Math.max(Math.random() * maxPctToTransfer, 0.0001);
		const pointsToTransfer = Math.max(
			minPointsToTransfer,
			Math.round(pctToTransfer * availablePoints)
		);

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
			` . Agent ${agent.key} will assign ${pointsToTransfer} points to ${friend}`
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

	const response = await fetch(`${moratUrl}/user/${key}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
	});

	if (response.status !== 200) {
		console.error(`Failed to create user ${key}`);
	} else {
		const body = await response.json();
		// console.log(body);
		console.log(` . Created user ${key} epoch ${body.epochSignUp}`);
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
	}
}

const allAgents = Array.from(agentKeys).map(createAgent);

console.log('Roll call...');
for (const agent of allAgents) {
	console.log(` . Agent ${agent.key} has ${agent.friends.length} friends`);
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
