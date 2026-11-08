import { useState } from 'react';
import { Picker } from '@react-native-picker/picker';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Journey } from '../core/journey-store';
import { feedbackCountsByFile, journeyProtocolFiles, protocolDiagramRows, protocolModuleViews, protocolTint } from '../core/protocol-viewer';
import type { AppColors } from './colors';
import { brandColors } from './colors';

export function ProtocolViewer(props: { journey: Journey; colors: AppColors; showJSONCode?: boolean }): React.JSX.Element {
	const [fileIndex, setFileIndex] = useState(0);
	const [jsonExpanded, setJsonExpanded] = useState(false);
	const files = journeyProtocolFiles(props.journey);
	const file = files[fileIndex];
	const feedbackCounts = feedbackCountsByFile(props.journey);
	const hasFeedback = feedbackCounts.some(function (counts): boolean { return(counts.up + counts.down > 0); });
	const modules = file === undefined ? undefined : protocolModuleViews(file.data);
	const styles = createStyles(props.colors);
	const isBrand = props.colors === brandColors;
	const phaseColors = isBrand ? { A: brandColors.section, B: brandColors.background } : (props.colors.background === '#121212' ? { A: '#5f7f9e', B: '#9a6477' } : { A: '#8fa8bf', B: '#c4a0ad' });
	return(
		<View style={styles.viewer}>
			<Text style={styles.title}>{props.journey.profile.name}</Text>
			<Text style={styles.text}>Run started {new Date(props.journey.startedAt).toLocaleString()}</Text>
			{files.length > 1 && (
				<View>
					<Text style={styles.text}>Protocol file</Text>
					<View style={styles.pickerRow}>
						<Pressable accessibilityRole="button" accessibilityLabel="Previous protocol file" onPress={function (): void { setFileIndex((fileIndex + files.length - 1) % files.length); }} style={styles.arrow}><Text style={styles.arrowText}>◀</Text></Pressable>
						<View style={styles.pickerFlex}>
						<Picker accessibilityLabel="Protocol file" selectedValue={fileIndex} onValueChange={function (value: number): void { setFileIndex(value); }} style={styles.picker}>
						{files.map(function (item, index) {
							return(<Picker.Item key={index} label={`${index + 1}. ${item.fileName}${feedbackLabel(feedbackCounts[index])}`} value={index} />);
						})}
					</Picker>
						</View>
						<Pressable accessibilityRole="button" accessibilityLabel="Next protocol file" onPress={function (): void { setFileIndex((fileIndex + 1) % files.length); }} style={styles.arrow}><Text style={styles.arrowText}>▶</Text></Pressable>
					</View>
				</View>
			)}
			{file !== undefined && <Text style={styles.fileName}>{file.fileName}</Text>}
			{hasFeedback && (
				<View style={styles.feedback}>
					<Text style={styles.heading}>Feedback during the session</Text>
					{files.map(function (item, index) {
						const counts = feedbackCounts[index];
						if (counts === undefined || counts.up + counts.down === 0) {
							return(null);
						}
						return(<Text key={index} style={index === fileIndex ? styles.feedbackSelected : styles.text}>{files.length > 1 ? `${index + 1}. ${item.fileName}: ` : ''}{`👍 ${counts.up}  👎 ${counts.down}`}</Text>);
					})}
				</View>
			)}
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
												{ backgroundColor: module.inactive ? props.colors.surface : protocolTint(phaseColors[module.phase], props.colors.surface, module.saturation) },
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
										return(<Text key={index} selectable style={[styles.cell, index === 0 && styles.ledName]}>{value}</Text>);
									})}
								</View>
							);
						})}
					</View>
				</>
			)}
			{props.showJSONCode === true && file !== undefined && (
				<View style={styles.jsonPanel}>
					<Pressable accessibilityRole="button" accessibilityState={{ expanded: jsonExpanded }} onPress={function (): void { setJsonExpanded(function (expanded): boolean { return(!expanded); }); }} style={styles.jsonHeading}>
						<Text style={styles.heading}>JSON</Text>
						<Text accessibilityLabel={jsonExpanded ? 'Collapse JSON' : 'Expand JSON'} style={styles.text}>{jsonExpanded ? '▼' : '▶'}</Text>
					</Pressable>
					{jsonExpanded && (
						<ScrollView style={styles.jsonBox} nestedScrollEnabled>
							<Text selectable style={styles.jsonText}>{JSON.stringify(file.data, undefined, 2)}</Text>
						</ScrollView>
					)}
				</View>
			)}
		</View>
	);
}

function feedbackLabel(counts: { up: number; down: number } | undefined): string {
	return(counts === undefined || counts.up + counts.down === 0 ? '' : `  👍${counts.up} 👎${counts.down}`);
}

function createStyles(colors: AppColors) {
	return(StyleSheet.create({
		viewer: { gap: 12 },
		title: { color: colors.title, fontSize: 24, fontWeight: '800', textAlign: 'center' },
		text: { color: colors.text, lineHeight: 20 },
		fileName: { color: colors.title, fontSize: 20, fontWeight: '700', textAlign: 'center' },
		pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
		pickerFlex: { flex: 1 },
		arrow: { paddingHorizontal: 10, paddingVertical: 8 },
		arrowText: { color: colors.accent, fontSize: 16 },
		picker: { backgroundColor: colors.surface, color: colors.inputText, borderColor: colors.border, borderWidth: 1, borderRadius: 8 },
		legend: { alignItems: 'center', borderColor: colors.border, borderRadius: 8, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'center', padding: 10 },
		legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
		swatch: { borderColor: colors.border, borderRadius: 3, borderWidth: 1, height: 18, width: 18 },
		feedback: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, gap: 4, padding: 10 },
		feedbackSelected: { color: colors.title, fontWeight: '700', lineHeight: 20 },
		jsonPanel: { borderColor: colors.border, borderRadius: 8, borderWidth: 1, gap: 8, padding: 10 },
		jsonHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
		jsonBox: { backgroundColor: '#0f172a', borderRadius: 7, maxHeight: 320, padding: 12 },
		jsonText: { color: '#e2e8f0', fontFamily: 'monospace', fontSize: 11 },
		heading: { color: colors.title, fontWeight: '700' },
		grid: { alignSelf: 'center', gap: 6, maxWidth: 400, width: '100%' },
		moduleRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
		tile: { alignItems: 'center', borderColor: colors.border, borderRadius: 7, borderWidth: 1, justifyContent: 'center', minHeight: 70, padding: 4, width: '31%' },
		crossTile: { borderColor: colors.text, borderWidth: 4 },
		moduleTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
		activeText: { color: colors.text },
		subtitle: { color: colors.text, fontSize: 12, textAlign: 'center' },
		table: { backgroundColor: colors.section, borderColor: colors.border, borderRadius: 8, borderWidth: 1, padding: 6 },
		tableRow: { alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', paddingVertical: 10 },
		cell: { color: colors.text, flex: 1, fontSize: 12, textAlign: 'center' },
		ledName: { color: colors === brandColors ? brandColors.background : colors.title, fontWeight: '800' },
		tableHeading: { color: colors.accent, fontSize: 10, fontWeight: '800' }
	}));
}
