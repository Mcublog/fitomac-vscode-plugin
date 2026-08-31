import * as vscode from 'vscode';

const LANGUAGE_IDS = new Set(['fito-macro']);

// Добавление декораций к редактору с очисткой предыдущих.
function renderParameterBadges(
    editor: vscode.TextEditor,
    badgeTypes: Map<number, vscode.TextEditorDecorationType>,
    commentType: vscode.TextEditorDecorationType,
    serviceType: vscode.TextEditorDecorationType
): void {
    if (!LANGUAGE_IDS.has(editor.document.languageId)) {
        return;
    }

    const badges = new Map<number, vscode.Range[]>();
    const commentRanges: vscode.Range[] = [];
    const serviceRanges: vscode.Range[] = [];
    const docLines = editor.document.lineCount;

    for (let line = 0; line < docLines; line++) {
        const lineRange = editor.document.lineAt(line).range;
        const lineText = editor.document.lineAt(line).text;

        // Пустые строки пропускаем без подсветки.
        const trimmed = lineText.trim();
        if (trimmed.length === 0) {
            continue;
        }

        // Служебные строки: заголовки '[...', специальные команды '&...',
        // условные '~...' и не-fatal префикс '*'. Подсвечиваются жёлтым и не нумеруются.
        if (
            trimmed.startsWith('[') ||
            trimmed.startsWith('&') ||
            trimmed.startsWith('~') ||
            trimmed.startsWith('*')
        ) {
            serviceRanges.push(lineRange);
            continue;
        }

        // Строки-комментарии подсвечиваем тёмно-зелёным и не нумеруем.
        if (trimmed.startsWith(';') || trimmed.startsWith('#')) {
            commentRanges.push(lineRange);
            continue;
        }

        // Считаем позиции всех ';' в строке. Последняя ';' — терминатор, без бейджа.
        let semicolonCount = 0;
        let semicolonsTotal = 0;
        for (let i = 0; i < lineText.length; i++) {
            if (lineText[i] === ';') {
                semicolonsTotal++;
            }
        }

        for (let i = 0; i < lineText.length; i++) {
            if (lineText[i] !== ';') {
                continue;
            }
            semicolonCount++;
            if (semicolonCount === semicolonsTotal) {
                // Последняя ';' — терминатор команды.
                break;
            }
            const position = new vscode.Position(
                line,
                lineRange.start.character + i + 1
            );
            let arr = badges.get(semicolonCount);
            if (!arr) {
                arr = [];
                badges.set(semicolonCount, arr);
            }
            arr.push(new vscode.Range(position, position));
        }
    }

    editor.setDecorations(commentType, commentRanges);
    editor.setDecorations(serviceType, serviceRanges);

    const config = vscode.workspace.getConfiguration('fito');
    if (!config.get<boolean>('parameterBadges.enabled', true)) {
        for (const type of badgeTypes.values()) {
            editor.setDecorations(type, []);
        }
        return;
    }

    // Очищаем декорации, которых больше нет, и применяем новые.
    const toClear: vscode.TextEditorDecorationType[] = [];
    for (const [num, type] of badgeTypes) {
        if (!badges.has(num)) {
            toClear.push(type);
        }
    }
    for (const type of toClear) {
        editor.setDecorations(type, []);
    }
    for (const [num, ranges] of badges) {
        const type = getBadgeType(badgeTypes, num);
        editor.setDecorations(type, ranges);
    }
}

function getBadgeType(
    badgeTypes: Map<number, vscode.TextEditorDecorationType>,
    num: number
): vscode.TextEditorDecorationType {
    let type = badgeTypes.get(num);
    if (!type) {
        const color = vscode.workspace
            .getConfiguration('fito')
            .get<string>('parameterBadges.color', '#8080809c');
        type = vscode.window.createTextEditorDecorationType({
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
            after: {
                contentText: String(num),
                color: color,
                // Небольшой отступ, чтобы бейдж не слипался с содержимым.
                margin: '0 0 0 0.2em',
                height: '1em'
            }
        });
        badgeTypes.set(num, type);
    }
    return type;
}

export function activate(context: vscode.ExtensionContext): void {
    const badgeTypes = new Map<number, vscode.TextEditorDecorationType>();
    const commentType = vscode.window.createTextEditorDecorationType({
        color: '#3F7A3F',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    context.subscriptions.push(commentType);

    const serviceType = vscode.window.createTextEditorDecorationType({
        color: '#E5C07B',
        rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    context.subscriptions.push(serviceType);

    const render = (editor: vscode.TextEditor | undefined): void => {
        if (!editor) {
            return;
        }
        renderParameterBadges(editor, badgeTypes, commentType, serviceType);
    };

    // Рендер при открытии/смене активного редактора.
    context.subscriptions.push(
        vscode.window.onDidChangeActiveTextEditor(render)
    );

    const visible = (editors: readonly vscode.TextEditor[]): void => {
        for (const editor of editors) {
            renderParameterBadges(editor, badgeTypes, commentType, serviceType);
        }
    };
    context.subscriptions.push(
        vscode.window.onDidChangeVisibleTextEditors(visible)
    );

    // Рендер при изменении текста документа (с небольшой задержкой).
    let timer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (!LANGUAGE_IDS.has(e.document.languageId)) {
                return;
            }
            if (timer) {
                clearTimeout(timer);
            }
            timer = setTimeout(() => {
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document === e.document) {
                    render(editor);
                }
            }, 150);
        })
    );

    // Рендер при изменении настроек, влияющих на цвет/включение.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('fito.parameterBadges')) {
                // Сбрасываем кэш типов декораций.
                badgeTypes.clear();
                render(vscode.window.activeTextEditor);
            }
        })
    );

    // Первичный рендер для всех открытых редакторов.
    for (const editor of vscode.window.visibleTextEditors) {
        renderParameterBadges(editor, badgeTypes, commentType, serviceType);
    }
}

export function deactivate(): void {}
