export async function scanLocalSubnet(subnetPrefix: string): Promise<string[]> {
	const octets = subnetPrefix.trim().split('.');
	if (octets.length !== 3 || octets.some(function (octet): boolean {
		const value = Number(octet);
		return(!Number.isInteger(value) || value < 0 || value > 255);
	})) {
		throw(new Error('Enter the first three IPv4 address parts, such as 192.168.1.'));
	}

	const addresses: string[] = [];
	for (let start = 1; start < 255; start += 16) {
		const probes: Promise<string | undefined>[] = [];
		for (let host = start; host < start + 16 && host < 255; host++) {
			const address = `${subnetPrefix.trim()}.${host}`;
			probes.push(probeAddress(address));
		}
		const results = await Promise.all(probes);
		for (const address of results) {
			if (address !== undefined) {
				addresses.push(address);
			}
		}
	}
	return(addresses);
}

async function probeAddress(address: string): Promise<string | undefined> {
	const controller = new AbortController();
	const timeout = setTimeout(function (): void {
		controller.abort();
	}, 1_200);
	try {
		await fetch(`http://${address}/activate?msg=Device%20discovery`, { signal: controller.signal });
		return(address);
	} catch {
		return(undefined);
	} finally {
		clearTimeout(timeout);
	}
}
