package fds

import "testing"

func TestReadNilStdin(t *testing.T) {
	_, err := Read("-", nil)
	if err == nil {
		t.Fatal("expected an error when stdin is nil")
	}
	_, err = Read("", nil)
	if err == nil {
		t.Fatal("expected an error when stdin is nil")
	}
}
