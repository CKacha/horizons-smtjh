<script>
  import { onDestroy } from 'svelte';
  import socket from '../socket.js';
  import { messages, myRole } from '../gameStore.js';

  const MAX_MESSAGES = 200;

  let inputValue = '';
  let activeChannel = 'all';
  let listEl;
  let roleVal = null;

  const unsubRole = myRole.subscribe(v => {
    roleVal = v;
    if (v !== 'alien') activeChannel = 'all';
  });

  /** @param {import('../gameStore.js').ChatMessage} payload */
  const onChatMessage = (payload) => {
    messages.update(arr => {
      const next = [...arr, payload];
      return next.length > MAX_MESSAGES ? next.slice(-MAX_MESSAGES) : next;
    });
    setTimeout(() => {
      if (listEl) listEl.scrollTop = listEl.scrollHeight;
    }, 0);
  };

  socket.on('chat_message', onChatMessage);

  function sendMessage() {
    const text = inputValue.trim();
    if (!text) return;
    socket.emit('chat', { message: text, channel: activeChannel });
    inputValue = '';
  }

  /** @param {KeyboardEvent} e */
  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      sendMessage();
    }
  }

  onDestroy(() => {
    unsubRole();
    socket.off('chat_message', onChatMessage);
  });
</script>

<div class="chat-panel">
  <div class="tabs">
    <button
      class="tab"
      class:active={activeChannel === 'all'}
      on:click={() => (activeChannel = 'all')}
    >ALL</button>

    {#if roleVal === 'alien'}
      <button
        class="tab alien-tab"
        class:active={activeChannel === 'alien'}
        on:click={() => (activeChannel = 'alien')}
      >ALIEN</button>
    {/if}
  </div>

  <div class="message-list" bind:this={listEl}>
    {#each $messages.filter(m => m.channel === activeChannel) as msg (`${msg.timestamp}-${msg.senderId}`)}
      <div class="msg" class:alien-msg={msg.channel === 'alien'}>
        <span class="msg-name" style="color: {msg.color}">{msg.name}</span>
        <span class="msg-text">{msg.message}</span>
      </div>
    {/each}
  </div>

  <div class="input-row">
    <input
      class="chat-input"
      type="text"
      placeholder="Say something..."
      maxlength="200"
      bind:value={inputValue}
      on:keydown={onKeyDown}
    />
    <button class="send-btn" on:click={sendMessage}>SEND</button>
  </div>
</div>

<style>
  .chat-panel {
    position: fixed;
    bottom: 16px;
    left: 16px;
    width: 280px;
    max-height: 340px;
    display: flex;
    flex-direction: column;
    background: rgba(10, 10, 20, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    z-index: 50;
    pointer-events: all;
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }

  .tab {
    flex: 1;
    padding: 6px 0;
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.45);
    font: bold 10px monospace;
    letter-spacing: 1px;
    cursor: pointer;
  }

  .tab.active {
    color: #fff;
    border-bottom: 2px solid #4ea8de;
  }

  .alien-tab.active {
    border-bottom-color: #e94560;
  }

  .message-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 80px;
    max-height: 220px;
  }

  .msg {
    display: flex;
    gap: 6px;
    word-break: break-word;
    line-height: 1.4;
  }

  .msg-name {
    font-weight: bold;
    white-space: nowrap;
  }

  .msg-text {
    color: rgba(255, 255, 255, 0.85);
  }

  .alien-msg {
    background: rgba(120, 0, 0, 0.25);
    border-radius: 3px;
    padding: 1px 4px;
  }

  .input-row {
    display: flex;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
  }

  .chat-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font: 12px monospace;
    padding: 6px 8px;
    outline: none;
  }

  .chat-input::placeholder {
    color: rgba(255, 255, 255, 0.25);
  }

  .send-btn {
    background: transparent;
    border: none;
    border-left: 1px solid rgba(255, 255, 255, 0.1);
    color: #4ea8de;
    font: bold 10px monospace;
    padding: 6px 10px;
    cursor: pointer;
    letter-spacing: 1px;
  }

  .send-btn:hover {
    background: rgba(255, 255, 255, 0.05);
  }
</style>
