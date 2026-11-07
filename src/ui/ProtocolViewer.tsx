import { useState } from 'react';
import { Picker } from '@react-native-picker/picker';
import { StyleSheet, Text, View } from 'react-native';

import type { Journey } from '../core/journey-store';
import { journeyProtocolFiles, protocolDiagramRows, protocolModuleViews, protocolTint } from '../core/protocol-viewer';
import type { AppColors } from './colors';
import { brandColors } from './colors';

export function ProtocolViewer(props: { journey: Journey; colors: AppColors }): React.JSX.Element {
	const [fileIndex, setFileIndex] = useState(0);
	const files = journeyProtocolFiles(props.journey);
	const file = files[fileIndex];
	const modules = file === undefined ? undefined : protocolModuleViews(file.data);
	const styles = createStyles(props.colors);
	const phaseColors = { A: brandColors.section, B: brandColors.accent };
	return(
		<View style={styles.viewer}>
			<Text style={styles.title}>{props.journey.profile.name}</Text>
			<Text style={styles.text}>Run started {new Date(props.journey.startedAt).toLocaleString()}</Text>
			{files.length > 1 && (
				<View>
					<Text style={styles.text}>Protocol file</Text>
					<Picker accessibilityLabel="Protocol file" selectedValue={fileIndex} onValueChange={function (value: number): void { setFileIndex(value); }} style={styles.picker}>
						{files.map(function (item, index) {
							return(<Picker.Item key={index} label={`${index + 1}. ${item.fileName}`} value={index} />);
						})}
					</Picker>
				</View>
			)}
			{file !== undefined && <Text style={styles.fileName}>{file.fileName}</Text>}
			{modules === undefined ? (
				<Text style={styles.text}>{file === undefined ? 'No protocol files were recorded for this journey.' : 'No readable channel parameters were saved for this protocol.'}</Text>
			) : (
				<>
					<View style={styles.legend}>
						{(['A', 'B'] as const).map(function (phase) {
							return(
								<View key={phase} style={styles.legendItem}>
									<View style={[styles.swatch, { backgroundColor: phaseColors[phase] }]} />
									<Text style={styles.heading}>Phase {phase}</Text>
								</View>
							);
						})}
					</View>
					<View style={styles.grid}>
						{protocolDiagramRows.map(function (row, index) {
							return(
								<View key={index} style={styles.moduleRow}>
									{row.map(function (name) {
										const module = modules.find(function (item): boolean { return(item.name === name); })!;
										const crossApplied = module.crossFrequency !== 'off';
										return(
											<View key={name} accessible accessibilityRole="text" accessibilityLabel={`${name}, ${module.inactive ? 'inactive' : `Phase ${module.phase}, ${module.frequency} Hz, ${module.power}%, ${module.runTime} minutes`}`} style={[
												styles.tile,
												{ backgroundColor: module.inactive ? props.colors.surface : protocolTint(phaseColors[module.phase], brandColors.surface, module.saturation) },
												crossApplied && styles.crossTile
											]}>
												<Text style={[styles.moduleTitle, !module.inactive && styles.activeText]}>{name}</Text>
												<Text style={[styles.subtitle, !module.inactive && styles.activeText]}>{module.inactive ? 'Inactive' : `${module.frequency}hz · ${module.power}%\n${module.runTime}m`}</Text>
												{crossApplied && <Text style={[styles.subtitle, styles.activeText]}>X:{module.crossFrequency}</Text>}
											</View>
										);
									})}
								</View>
							);
						})}
					</View>
					<View style={styles.table}>
						<View style={styles.tableRow}>
							{['', 'PWR\n%', 'FREQ\nHZ', 'CROSS\nFREQ', 'PHASE', 'DELAY/\nACTIVE'].map(function (title) {
								return(<Text key={title} style={[styles.cell, styles.tableHeading]}>{title}</Text>);
							})}
						</View>
						{modules.map(function (module) {
							return(
								<View key={module.number} style={styles.tableRow}>
									{[module.name, module.power, module.frequency, module.crossFrequency, module.phase, `${module.delay}/${module.runTime}`].map(function (value, index) {
										return(<Text key={index} selectable style={[styles.cell, index === 0 && styles.heading]}>{value}</Text>);
									})}
								</View>
							);
						})}
					</View>
				</>
			)}
		</View>
	);
}

function createStyles(colors: AppColors) {
	return(StyleSheet.create({
		viewer: { gap: 12 },
		title: { color: colors.title, fontSize: 24, fontWeight: '800', textAlign: 'center' },
		text: { color: colors.text, lineHeight: 20 },
		fileName: { color: colors.title, fontSize: 20, fontWeight: '700', textAlign: 'center' },
		picker: { backgroundColor: colors.surface, color: colors.inputText, borderColor: colors.border, borderWidth: 1, borderRadius: 8 },
		legend: { alignItems: 'center', borderColor: colors.border, borderRadius: 8, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center', padding: 10 },
		legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
		swatch: { borderColor: colors.border, borderRadius: 3, borderWidth: 1, height: 18, width: 18 },
		heading: { color: colors.title, fontWeight: '700' },
		grid: { alignSelf: 'center', gap: 6, maxWidth: 400, width: '100%' },
		moduleRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
		tile: { alignItems: 'center', borderColor: colors.border, borderRadius: 7, borderWidth: 1, justifyContent: 'center', minHeight: 70, padding: 4, width: '31%' },
		crossTile: { borderColor: colors.text, borderWidth: 4 },
		moduleTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
		activeText: { color: brandColors.text },
		subtitle: { color: colors.text, fontSize: 12, textAlign: 'center' },
		table: { backgroundColor: colors.section, borderColor: colors.border, borderRadius: 8, borderWidth: 1, padding: 6 },
		tableRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: 10 },
		cell: { color: colors.text, flex: 1, fontSize: 12, textAlign: 'center' },
		tableHeading: { color: colors.title, fontSize: 10, fontWeight: '800' }
	}));
}
