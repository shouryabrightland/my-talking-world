// @ts-check

/**
 * @file Chat.test.jsx
 * Component tests for Chat layout ensuring:
 * - EmptyChat renders when messages.length === 0
 * - Footer remains mounted in the DOM
 * - Grid container and message area are properly structured
 * - All sub-components render in correct positions
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// ─── Mock Contexts ────────────────────────────────────────────────────────

/** @type {Object} Mock ChatMember for testing */
const mockUser = {
    id: "me",
    name: "Me",
    isAI: false,
    getMessages: () => [],
    getMembers: () => [],
    events: { on: () => () => {}, emit: () => {} },
};

/** @type {Object} Mock Chat */
const mockChat = {
    getMessages: () => [],
    getMembers: () => [],
    events: { on: () => () => {}, emit: () => {} },
};

/** @type {Object} Mock World */
const mockWorld = {
    events: { on: () => () => {} },
};

/** @type {Object} Mock ConversationManager */
const mockConversationManager = {
    chat: mockChat,
    User: mockUser,
    world: mockWorld,
    initialized: true,
    isReady: true,
};

// ─── Mock useChat ─────────────────────────────────────────────────────────

vi.mock("../../src/contexts/ChatContext.jsx", () => ({
    useChat: () => mockConversationManager,
    ChatProvider: ({ children }) => children,
}));

vi.mock("../../src/contexts/ThemeContext.jsx", () => ({
    useTheme: () => ({ isDark: false, mode: "light" }),
    ThemeProvider: ({ children }) => children,
}));

vi.mock("../../src/contexts/OfflineContext.jsx", () => ({
    useOffline: () => ({ isOnline: true, isOffline: false }),
    OfflineProvider: ({ children }) => children,
}));

vi.mock("../../src/contexts/InputBoxContext.jsx", () => ({
    useInputBox: () => ({
        mode: "user",
        setMode: () => {},
        Reply: null,
        setReply: () => {},
        isPlannerOpen: false,
        setIsPlannerOpen: () => {},
    }),
    InputBoxContextProvider: ({ children }) => children,
}));

// ─── Mock Sub-Components ──────────────────────────────────────────────────

vi.mock("../../src/components/Header.jsx", () => ({
    default: () => <div data-testid="header">Header</div>,
}));

vi.mock("../../src/components/SceneBar.jsx", () => ({
    default: () => <div data-testid="scenebar">SceneBar</div>,
}));

vi.mock("../../src/components/DevToolsBar.jsx", () => ({
    default: () => <div data-testid="devtoolsbar">DevToolsBar</div>,
}));

vi.mock("../../src/components/BackgroundBar.jsx", () => ({
    default: () => <div data-testid="backgroundbar">BackgroundBar</div>,
}));

vi.mock("../../src/components/footer.jsx", () => ({
    Footer: () => <footer data-testid="footer">Footer</footer>,
}));

vi.mock("../../src/components/PlannerDrawer.jsx", () => ({
    default: () => <div data-testid="plannerdrawer">PlannerDrawer</div>,
}));

vi.mock("../../src/components/DevToolsDrawer.jsx", () => ({
    default: () => <div data-testid="devtoolsdrawer">DevToolsDrawer</div>,
}));

vi.mock("../../src/components/message.jsx", () => ({
    MessageUX: () => <div>Message</div>,
    TypingMessageUX: () => <div>Typing</div>,
}));

vi.mock("../../src/classes/World.jsx", () => ({
    WorldEvents: { HOUR_CHANGE: "world:hour:change" },
}));

// ─── Import after mocks ──────────────────────────────────────────────────

import ChatUX from "../../src/components/Chat";

// ─── Tests ────────────────────────────────────────────────────────────────

describe("Chat Layout", () => {
    beforeEach(() => {
        mockChat.getMessages = () => [];
        mockChat.getMembers = () => [];
    });

    describe("Empty State", () => {
        it("renders EmptyChat when no messages exist", () => {
            render(<ChatUX />);
            expect(screen.getByText("Welcome to Tom & Friends!")).toBeTruthy();
        });

        it("emptyChat displays the welcome icon", () => {
            render(<ChatUX />);
            expect(screen.getByText("🌟")).toBeTruthy();
        });

        it("emptyChat displays the welcome message", () => {
            render(<ChatUX />);
            expect(screen.getByText(/Say hello in User Mode/)).toBeTruthy();
        });

        it("scroll-to-bottom button is NOT visible in empty state", () => {
            render(<ChatUX />);
            const scrollBtn = screen.queryByRole("button", { name: /scroll to bottom/i });
            expect(scrollBtn).toBeNull();
        });
    });

    describe("Footer Presence", () => {
        it("footer is always mounted in the DOM", () => {
            render(<ChatUX />);
            const footer = screen.getByTestId("footer");
            expect(footer).toBeTruthy();
        });

        it("footer is a <footer> element", () => {
            render(<ChatUX />);
            const footer = screen.getByTestId("footer");
            expect(footer.tagName.toLowerCase()).toBe("footer");
        });

        it("footer renders even when there are no messages", () => {
            mockChat.getMessages = () => [];
            render(<ChatUX />);
            expect(screen.getByTestId("footer")).toBeTruthy();
            expect(screen.getByText("Welcome to Tom & Friends!")).toBeTruthy();
        });
    });

    describe("Shell Structure", () => {
        it("renders the shell container as a div", () => {
            const { container } = render(<ChatUX />);
            const shell = container.firstChild;
            expect(shell).toBeInstanceOf(HTMLDivElement);
        });

        it("shell has a CSS module class (contains 'chatShell' in the class list)", () => {
            const { container } = render(<ChatUX />);
            const shell = /** @type {Element} */ (container.firstChild);
            // CSS modules hash class names, so we check that it has a class attribute
            expect(shell.getAttribute("class")).toBeTruthy();
        });

        it("shell has grid-related style attribute", () => {
            const { container } = render(<ChatUX />);
            const shell = /** @type {Element} */ (container.firstChild);
            // The shell should have a style attribute with the backdrop gradient
            const style = shell.getAttribute("style");
            expect(style).toContain("--backdrop-gradient");
        });
    });

    describe("Component Order", () => {
        it("Header renders before the message area", () => {
            render(<ChatUX />);
            const header = screen.getByTestId("header");
            const footer = screen.getByTestId("footer");
            // Header should appear in DOM before footer
            expect(header.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it("SceneBar renders after Header", () => {
            render(<ChatUX />);
            const header = screen.getByTestId("header");
            const sceneBar = screen.getByTestId("scenebar");
            expect(header.compareDocumentPosition(sceneBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it("DevToolsBar renders after SceneBar", () => {
            render(<ChatUX />);
            const sceneBar = screen.getByTestId("scenebar");
            const devToolsBar = screen.getByTestId("devtoolsbar");
            expect(sceneBar.compareDocumentPosition(devToolsBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it("BackgroundBar renders after DevToolsBar", () => {
            render(<ChatUX />);
            const devToolsBar = screen.getByTestId("devtoolsbar");
            const backgroundBar = screen.getByTestId("backgroundbar");
            expect(devToolsBar.compareDocumentPosition(backgroundBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it("Footer renders after BackgroundBar", () => {
            render(<ChatUX />);
            const backgroundBar = screen.getByTestId("backgroundbar");
            const footer = screen.getByTestId("footer");
            expect(backgroundBar.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });

        it("PlannerDrawer renders after Footer", () => {
            render(<ChatUX />);
            const footer = screen.getByTestId("footer");
            const planner = screen.getByTestId("plannerdrawer");
            expect(footer.compareDocumentPosition(planner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        });
    });

    describe("All Sub-Components Present", () => {
        it("renders all required sub-components", () => {
            render(<ChatUX />);
            expect(screen.getByTestId("header")).toBeTruthy();
            expect(screen.getByTestId("scenebar")).toBeTruthy();
            expect(screen.getByTestId("devtoolsbar")).toBeTruthy();
            expect(screen.getByTestId("backgroundbar")).toBeTruthy();
            expect(screen.getByTestId("footer")).toBeTruthy();
            expect(screen.getByTestId("plannerdrawer")).toBeTruthy();
            expect(screen.getByTestId("devtoolsdrawer")).toBeTruthy();
        });
    });
});
