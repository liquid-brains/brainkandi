// Decides whether a newly running protocol file is a switch from an earlier one.
export function isSwitchingFiles(previousFileName: string | undefined, hasStartedFile: boolean, fileName: string | undefined): boolean {
	return(fileName !== undefined && hasStartedFile && fileName !== previousFileName);
}
