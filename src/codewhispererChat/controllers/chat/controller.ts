/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { EditorContextExtractor } from '../../editor/context/extractor'
import { ChatSessionStorage } from '../../storages/chatSession'
import { Messenger } from './messenger/messenger'
import {
    PromptMessage,
    ChatTriggerType,
    TriggerPayload,
    TabClosedMessage,
    InsertCodeAtCursorPosition,
    TriggerTabIDReceived,
    StopResponseMessage,
    CopyCodeToClipboard,
    ChatItemVotedMessage,
    ChatItemFeedbackMessage,
    TabCreatedMessage,
    TabChangedMessage,
    UIFocusMessage,
    SourceLinkClickMessage,
    ResponseBodyLinkClickMessage,
} from './model'
import { AppToWebViewMessageDispatcher } from '../../view/connector/connector'
import { MessagePublisher } from '../../../amazonq/messages/messagePublisher'
import { MessageListener } from '../../../amazonq/messages/messageListener'
import { EditorContentController } from '../../editor/context/contentController'
import { EditorContextCommand } from '../../commands/registerCommands'
import { PromptsGenerator } from './prompts/promptsGenerator'
import { TriggerEventsStorage } from '../../storages/triggerEvents'
import { randomUUID } from 'crypto'
import {
    CodeWhispererStreamingServiceException,
    GenerateAssistantResponseCommandOutput,
} from '@amzn/codewhisperer-streaming'
import { UserIntentRecognizer } from './userIntent/userIntentRecognizer'
import { CWCTelemetryHelper } from './telemetryHelper'
import { CodeWhispererTracker } from '../../../codewhisperer/tracker/codewhispererTracker'
import { getLogger } from '../../../shared/logger/logger'
import { triggerPayloadToChatRequest } from './chatRequest/converter'
import { OnboardingPageInteraction } from '../../../amazonq/onboardingPage/model'
import { AuthUtil } from '../../../codewhisperer/util/authUtil'
import { ExternalBrowserUtils } from '../../../amazonq/commons/externalBrowser/externalBrowserUtils'

export interface ChatControllerMessagePublishers {
    readonly processPromptChatMessage: MessagePublisher<PromptMessage>
    readonly processTabCreatedMessage: MessagePublisher<TabCreatedMessage>
    readonly processTabClosedMessage: MessagePublisher<TabClosedMessage>
    readonly processTabChangedMessage: MessagePublisher<TabChangedMessage>
    readonly processInsertCodeAtCursorPosition: MessagePublisher<InsertCodeAtCursorPosition>
    readonly processCopyCodeToClipboard: MessagePublisher<CopyCodeToClipboard>
    readonly processContextMenuCommand: MessagePublisher<EditorContextCommand>
    readonly processTriggerTabIDReceived: MessagePublisher<TriggerTabIDReceived>
    readonly processStopResponseMessage: MessagePublisher<StopResponseMessage>
    readonly processChatItemVotedMessage: MessagePublisher<ChatItemVotedMessage>
    readonly processChatItemFeedbackMessage: MessagePublisher<ChatItemFeedbackMessage>
    readonly processUIFocusMessage: MessagePublisher<UIFocusMessage>    
    readonly processOnboardingPageInteraction: MessagePublisher<OnboardingPageInteraction>
    readonly processSourceLinkClick: MessagePublisher<SourceLinkClickMessage>
    readonly processResponseBodyLinkClick:MessagePublisher<ResponseBodyLinkClickMessage>
}

export interface ChatControllerMessageListeners {
    readonly processPromptChatMessage: MessageListener<PromptMessage>
    readonly processTabCreatedMessage: MessageListener<TabCreatedMessage>
    readonly processTabClosedMessage: MessageListener<TabClosedMessage>
    readonly processTabChangedMessage: MessageListener<TabChangedMessage>
    readonly processInsertCodeAtCursorPosition: MessageListener<InsertCodeAtCursorPosition>
    readonly processCopyCodeToClipboard: MessageListener<CopyCodeToClipboard>
    readonly processContextMenuCommand: MessageListener<EditorContextCommand>
    readonly processTriggerTabIDReceived: MessageListener<TriggerTabIDReceived>
    readonly processStopResponseMessage: MessageListener<StopResponseMessage>
    readonly processChatItemVotedMessage: MessageListener<ChatItemVotedMessage>
    readonly processChatItemFeedbackMessage: MessageListener<ChatItemFeedbackMessage>
    readonly processUIFocusMessage: MessageListener<UIFocusMessage>
    readonly processOnboardingPageInteraction: MessageListener<OnboardingPageInteraction>
    readonly processSourceLinkClick: MessageListener<SourceLinkClickMessage>
    readonly processResponseBodyLinkClick:MessageListener<ResponseBodyLinkClickMessage>
}

export class ChatController {
    private readonly sessionStorage: ChatSessionStorage
    private readonly triggerEventsStorage: TriggerEventsStorage
    private readonly messenger: Messenger
    private readonly editorContextExtractor: EditorContextExtractor
    private readonly editorContentController: EditorContentController
    private readonly promptGenerator: PromptsGenerator
    private readonly userIntentRecognizer: UserIntentRecognizer
    private readonly telemetryHelper: CWCTelemetryHelper

    public constructor(
        private readonly chatControllerMessageListeners: ChatControllerMessageListeners,
        appsToWebViewMessagePublisher: MessagePublisher<any>
    ) {
        this.sessionStorage = new ChatSessionStorage()
        this.triggerEventsStorage = new TriggerEventsStorage()
        this.telemetryHelper = new CWCTelemetryHelper(this.sessionStorage, this.triggerEventsStorage)
        this.messenger = new Messenger(
            new AppToWebViewMessageDispatcher(appsToWebViewMessagePublisher),
            this.telemetryHelper
        )
        this.editorContextExtractor = new EditorContextExtractor()
        this.editorContentController = new EditorContentController()
        this.promptGenerator = new PromptsGenerator()
        this.userIntentRecognizer = new UserIntentRecognizer()

        this.chatControllerMessageListeners.processPromptChatMessage.onMessage(data => {
            this.processPromptChatMessage(data)
        })

        this.chatControllerMessageListeners.processTabCreatedMessage.onMessage(data => {
            this.processTabCreateMessage(data)
        })

        this.chatControllerMessageListeners.processTabClosedMessage.onMessage(data => {
            this.processTabCloseMessage(data)
        })

        this.chatControllerMessageListeners.processTabChangedMessage.onMessage(data => {
            this.processTabChangedMessage(data)
        })

        this.chatControllerMessageListeners.processInsertCodeAtCursorPosition.onMessage(data => {
            this.processInsertCodeAtCursorPosition(data)
        })

        this.chatControllerMessageListeners.processCopyCodeToClipboard.onMessage(data => {
            this.processCopyCodeToClipboard(data)
        })

        this.chatControllerMessageListeners.processContextMenuCommand.onMessage(data => {
            this.processContextMenuCommand(data)
        })

        this.chatControllerMessageListeners.processTriggerTabIDReceived.onMessage(data => {
            this.processTriggerTabIDReceived(data)
        })

        this.chatControllerMessageListeners.processStopResponseMessage.onMessage(data => {
            this.processStopResponseMessage(data)
        })

        this.chatControllerMessageListeners.processChatItemVotedMessage.onMessage(data => {
            this.processChatItemVotedMessage(data)
        })

        this.chatControllerMessageListeners.processChatItemFeedbackMessage.onMessage(data => {
            this.processChatItemFeedbackMessage(data)
        })

        this.chatControllerMessageListeners.processUIFocusMessage.onMessage(data => {
            this.processUIFocusMessage(data)
        })

        this.chatControllerMessageListeners.processOnboardingPageInteraction.onMessage(data => {
            this.processOnboardingPageInteraction(data)
        })
        this.chatControllerMessageListeners.processSourceLinkClick.onMessage(data => {
            this.processSourceLinkClick(data)
        })
        this.chatControllerMessageListeners.processResponseBodyLinkClick.onMessage(data => {
            this.processResponseBodyLinkClick(data)
        })
    }


    private openLinkInExternalBrowser(click: ResponseBodyLinkClickMessage | SourceLinkClickMessage){
        this.telemetryHelper.recordInteractWithMessage({
            command: 'link-was-clicked',
            tabID: click.tabID,
            messageId: click.messageId,
            url: click.link

        })
        ExternalBrowserUtils.instance.openLink(click.link)
    }    

    private processResponseBodyLinkClick(click: ResponseBodyLinkClickMessage){    
        this.openLinkInExternalBrowser(click)
    }

    private processSourceLinkClick(click: SourceLinkClickMessage){
        this.openLinkInExternalBrowser(click)
    }

    private processOnboardingPageInteraction(interaction: OnboardingPageInteraction) {
        this.editorContextExtractor
            .extractContextForTrigger('OnboardingPageInteraction')
            .then(context => {
                const triggerID = randomUUID()

                const prompt = this.promptGenerator.generateForOnboardingPageInteraction(interaction)

                this.messenger.sendOnboardingPageInteractionMessage(interaction, triggerID)

                this.triggerEventsStorage.addTriggerEvent({
                    id: triggerID,
                    tabID: undefined,
                    message: prompt,
                    type: 'onboarding_page_interaction',
                    context,
                    onboardingPageInteraction: interaction,
                })

                this.generateResponse(
                    {
                        message: prompt,
                        trigger: ChatTriggerType.ChatMessage,
                        query: undefined,
                        codeSelection: context?.focusAreaContext?.selectionInsideExtendedCodeBlock,
                        fileText: context?.focusAreaContext?.extendedCodeBlock,
                        fileLanguage: context?.activeFileContext?.fileLanguage,
                        filePath: context?.activeFileContext?.filePath,
                        matchPolicy: context?.activeFileContext?.matchPolicy,
                        codeQuery: context?.focusAreaContext?.names,
                        userIntent: this.userIntentRecognizer.getFromOnboardingPageInteraction(interaction),
                    },
                    triggerID
                )
            })
            .catch(e => {
                this.processException(e, '')
            })
    }

    private async processChatItemFeedbackMessage(message: ChatItemFeedbackMessage) {
        await this.telemetryHelper.recordFeedback(message)
    }

    private async processChatItemVotedMessage(message: ChatItemVotedMessage) {
        this.telemetryHelper.recordInteractWithMessage(message)
    }

    private async processStopResponseMessage(message: StopResponseMessage) {
        const session = this.sessionStorage.getSession(message.tabID)
        session.tokenSource.cancel()
    }

    private async processTriggerTabIDReceived(message: TriggerTabIDReceived) {
        this.triggerEventsStorage.updateTriggerEventTabIDFromUnknown(message.triggerID, message.tabID)
    }

    private async processInsertCodeAtCursorPosition(message: InsertCodeAtCursorPosition) {
        this.editorContentController.insertTextAtCursorPosition(message.code, (editor, cursorStart) => {
            CodeWhispererTracker.getTracker().enqueue({
                conversationID: this.telemetryHelper.getConversationId(message.tabID) ?? '',
                messageID: message.messageId,
                time: new Date(),
                fileUrl: editor.document.uri,
                startPosition: cursorStart,
                endPosition: editor.selection.active,
                originalString: message.code,
            })
        })
        this.telemetryHelper.recordInteractWithMessage(message)
    }

    private async processCopyCodeToClipboard(message: CopyCodeToClipboard) {
        this.telemetryHelper.recordInteractWithMessage(message)
    }

    private async processTabCreateMessage(message: TabCreatedMessage) {
        // this.telemetryHelper.recordOpenChat(message.tabOpenInteractionType)
    }

    private async processTabCloseMessage(message: TabClosedMessage) {
        this.sessionStorage.deleteSession(message.tabID)
        this.triggerEventsStorage.removeTabEvents(message.tabID)
        // this.telemetryHelper.recordCloseChat(message.tabID)
    }

    private async processTabChangedMessage(message: TabChangedMessage) {
        if (message.prevTabID) {
            this.telemetryHelper.recordExitFocusConversation(message.prevTabID)
        }
        this.telemetryHelper.recordEnterFocusConversation(message.tabID)
    }

    private async processUIFocusMessage(message: UIFocusMessage) {
        switch (message.type) {
            case 'focus':
                this.telemetryHelper.recordEnterFocusChat()
                break
            case 'blur':
                this.telemetryHelper.recordExitFocusChat()
                break
        }
    }

    private processException(e: any, tabID: string) {
        let errorMessage = ''
        let requestID = undefined
        const defaultMessage = 'Failed to get response'
        if (typeof e === 'string') {
            errorMessage = e.toUpperCase()
        } else if (e instanceof SyntaxError) {
            // Workaround to handle case when LB returns web-page with error and our client doesn't return proper exception
            // eslint-disable-next-line no-prototype-builtins
            if (e.hasOwnProperty('$response')) {
                type exceptionKeyType = keyof typeof e
                const responseKey = '$response' as exceptionKeyType
                const response = e[responseKey]

                let reason

                if (response) {
                    type responseKeyType = keyof typeof response
                    const reasonKey = 'reason' as responseKeyType
                    reason = response[reasonKey]
                }

                errorMessage = reason ? (reason as string) : defaultMessage
            } else {
                errorMessage = defaultMessage
            }
        } else if (e instanceof CodeWhispererStreamingServiceException) {
            errorMessage = e.message
            requestID = e.$metadata.requestId
        } else if (e instanceof Error) {
            errorMessage = e.message
        }

        this.messenger.sendErrorMessage(errorMessage, tabID, requestID)
        getLogger().error(`error: ${errorMessage} tabID: ${tabID} requestID: ${requestID}`)

        this.sessionStorage.deleteSession(tabID)
    }

    private async processContextMenuCommand(command: EditorContextCommand) {
        // Just open the chat panel in this case
        if (!this.editorContextExtractor.isCodeBlockSelected() && command.type === 'aws.amazonq.sendToPrompt') {
            return
        }

        this.editorContextExtractor
            .extractContextForTrigger('ContextMenu')
            .then(context => {
                const triggerID = randomUUID()

                if (context?.focusAreaContext?.codeBlock === undefined) {
                    throw 'Sorry, we cannot help with the selected language code snippet'
                }

                const prompt = this.promptGenerator.generateForContextMenuCommand(command)

                this.messenger.sendEditorContextCommandMessage(
                    command.type,
                    context?.focusAreaContext?.codeBlock ?? '',
                    triggerID
                )

                if (command.type === 'aws.amazonq.sendToPrompt') {
                    // No need for response if send the code to prompt
                    return
                }

                this.triggerEventsStorage.addTriggerEvent({
                    id: triggerID,
                    tabID: undefined,
                    message: prompt,
                    type: 'editor_context_command',
                    context,
                    command,
                })

                this.generateResponse(
                    {
                        message: prompt,
                        trigger: ChatTriggerType.ChatMessage,
                        query: undefined,
                        codeSelection: context?.focusAreaContext?.selectionInsideExtendedCodeBlock,
                        fileText: context?.focusAreaContext?.extendedCodeBlock,
                        fileLanguage: context?.activeFileContext?.fileLanguage,
                        filePath: context?.activeFileContext?.filePath,
                        matchPolicy: context?.activeFileContext?.matchPolicy,
                        codeQuery: context?.focusAreaContext?.names,
                        userIntent: this.userIntentRecognizer.getFromContextMenuCommand(command),
                    },
                    triggerID
                )
            })
            .catch(e => {
                this.processException(e, '')
            })
    }

    private async processPromptChatMessage(message: PromptMessage) {
        if (message.message === undefined) {
            this.messenger.sendErrorMessage('chatMessage should be set', message.tabID, undefined)
            return
        }

        try {
            switch (message.command) {
                case 'follow-up-was-clicked':
                    await this.processFollowUp(message)
                    this.telemetryHelper.recordInteractWithMessage(message)
                    break
                case 'onboarding-page-cwc-button-clicked':
                case 'chat-prompt':
                    await this.processPromptMessageAsNewThread(message)
                    break
                default:
                    await this.processCommandMessage(message)
            }
        } catch (e) {
            this.processException(e, message.tabID)
        }
    }

    private async processCommandMessage(message: PromptMessage) {
        if (message.command === 'clear') {
            this.sessionStorage.deleteSession(message.tabID)
            this.triggerEventsStorage.removeTabEvents(message.tabID)
            return
        }
    }

    private async processFollowUp(message: PromptMessage) {
        try {
            const lastTriggerEvent = this.triggerEventsStorage.getLastTriggerEventByTabID(message.tabID)

            if (lastTriggerEvent === undefined) {
                throw "It's impossible to ask follow-ups on empty tabs"
            }

            const triggerID = randomUUID()
            this.triggerEventsStorage.addTriggerEvent({
                id: triggerID,
                tabID: message.tabID,
                message: message.message,
                type: 'follow_up',
                context: lastTriggerEvent.context,
            })

            this.generateResponse(
                {
                    message: message.message,
                    trigger: ChatTriggerType.ChatMessage,
                    query: message.message,
                    codeSelection: lastTriggerEvent.context?.focusAreaContext?.selectionInsideExtendedCodeBlock,
                    fileText: lastTriggerEvent.context?.focusAreaContext?.extendedCodeBlock,
                    fileLanguage: lastTriggerEvent.context?.activeFileContext?.fileLanguage,
                    filePath: lastTriggerEvent.context?.activeFileContext?.filePath,
                    matchPolicy: lastTriggerEvent.context?.activeFileContext?.matchPolicy,
                    codeQuery: lastTriggerEvent.context?.focusAreaContext?.names,
                    userIntent: message.userIntent,
                },
                triggerID
            )
        } catch (e) {
            this.processException(e, message.tabID)
        }
    }

    private async processPromptMessageAsNewThread(message: PromptMessage) {
        this.editorContextExtractor
            .extractContextForTrigger('ChatMessage')
            .then(context => {
                const triggerID = randomUUID()
                this.triggerEventsStorage.addTriggerEvent({
                    id: triggerID,
                    tabID: message.tabID,
                    message: message.message,
                    type: 'chat_message',
                    context,
                })
                this.generateResponse(
                    {
                        message: message.message,
                        trigger: ChatTriggerType.ChatMessage,
                        query: message.message,
                        codeSelection: context?.focusAreaContext?.selectionInsideExtendedCodeBlock,
                        fileText: context?.focusAreaContext?.extendedCodeBlock,
                        fileLanguage: context?.activeFileContext?.fileLanguage,
                        filePath: context?.activeFileContext?.filePath,
                        matchPolicy: context?.activeFileContext?.matchPolicy,
                        codeQuery: context?.focusAreaContext?.names,
                        userIntent: this.userIntentRecognizer.getFromPromptChatMessage(message),
                    },
                    triggerID
                )
            })
            .catch(e => {
                this.processException(e, message.tabID)
            })
    }

    private async generateResponse(triggerPayload: TriggerPayload, triggerID: string) {
        // Loop while we waiting for tabID to be set
        const triggerEvent = this.triggerEventsStorage.getTriggerEvent(triggerID)
        if (triggerEvent === undefined) {
            return
        }
        if (triggerEvent.tabID === undefined) {
            setTimeout(() => {
                this.generateResponse(triggerPayload, triggerID)
            }, 20)
            return
        }
        
        const tabID = triggerEvent.tabID

        const credentialsState = await AuthUtil.instance.getCodeWhispererCredentialState()
                
        if (credentialsState !== undefined) {
            this.messenger.sendAuthNeededExceptionMessage(credentialsState, tabID, triggerID)
            return
        }

        const request = triggerPayloadToChatRequest(triggerPayload)
        const session = this.sessionStorage.getSession(tabID)
        getLogger().info(
            `request from tab: ${tabID} coversationID: ${session.sessionIdentifier} request: ${JSON.stringify(request)}`
        )
        let response: GenerateAssistantResponseCommandOutput | undefined = undefined
        session.createNewTokenSource()
        try {
            response = await session.chat(request)
            this.telemetryHelper.recordEnterFocusConversation(triggerEvent.tabID)
            this.telemetryHelper.recordStartConversation(triggerEvent, triggerPayload)

            getLogger().info(
                `response to tab: ${tabID} coversationID: ${session.sessionIdentifier} requestID: ${
                    response.$metadata.requestId
                } metadata: ${JSON.stringify(response.$metadata)}`
            )
            this.messenger.sendAIResponse(response, session, tabID, triggerID, triggerPayload)
        } catch (e) {
            this.processException(e, tabID)
            this.telemetryHelper.recordMessageResponseError(
                triggerPayload,
                tabID,
                response?.$metadata?.httpStatusCode ?? 0
            )
        }
    }
}
